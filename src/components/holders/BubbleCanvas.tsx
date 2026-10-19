import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { glyphPaths, sideColour, type FlowEvent, type Glyph } from './motion'
import { K } from './theme'
import { shade } from './palette'
import { esc } from '../charts/chart-utils'

/* The Holder Map's bubbles, drawn on one canvas with requestAnimationFrame (this module is its own lazy
   chunk). It owns everything that moves, so React renders only when the data changes:
   - look: every bubble is a lit sphere (radial gradient and a soft highlight) in its meaning's colour, with a
     glow on clusters, a brighter rim on the top 10 and a halo behind each cluster; links are curved lines whose
     opacity follows the transfer count;
   - entrance: bubbles grow out of the centre, where the token sits, and settle into the layout;
   - idle life: every bubble breathes and drifts, pools and locks pulse, links carry particles;
   - hover lifts a bubble (it grows, casts a shadow, nudges its neighbours aside); a click flies the camera to it;
   - flows: a transfer is a stream of particles from sender to receiver (gold buys, red sells), and the
     receiving bubble grows or shrinks when the stream lands;
   - hover lights a wallet's cluster and its links and dims the rest; a tooltip follows the pointer;
   - the camera fits the map, flies to a wallet, zooms (ctrl/⌘ + wheel, pinch, buttons) and pans (drag).
   Under reduced motion the map fades in where it lands and sizes change in place, but it is never frozen: the
   bubbles drift slowly (a fraction of the speed and reach), and a flow is a line that fades in and out.
   The loop stops while the map is off-screen or the tab is hidden, and particles are capped. */

export interface BNode {
  id: string
  /** Layout position and radius (abstract units; the camera fits them to the box). */
  x: number
  y: number
  r: number
  /** The radius the camera fits to (the layout's, so the view holds still while sizes change). */
  fitR?: number
  /** The sphere's base colour (palette.ts); the canvas shades it into a highlight and a dark edge. */
  hue: string
  /** The outline: its colour and width (bundled buyers are red and dashed, the top 10 brighter). */
  rim: string
  rimWidth: number
  dashed: boolean
  /** Clusters glow. */
  glow: boolean
  /** Share text drawn inside big enough bubbles. */
  text: string | null
  textColour: string
  glyph: Glyph | null
  /** The token's own logo, drawn inside the bubble that is the token. */
  logo?: string | null
  /** What an infrastructure bubble is (POOL, LOCK…): inside big ones, on a tab under small ones. */
  caption: string | null
  /** What any bubble is, in words ("wallet", "contract"): inside bubbles big enough to carry it. */
  kindText: string
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
  /** 0..1, from the transfer count: the line's opacity. */
  strength: number
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
  /** Room kept free under the map on a wide screen (the replay bar); default fits a bar over the map. */
  padBottom?: number
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
  /** 0..1: how far the hover has lifted this bubble. */
  lift: number
  /** Where the hover nudged it (screen pixels), eased. */
  ox: number
  oy: number
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
const withAlpha = (hex: string, a: number) =>
  `${hex.slice(0, 7)}${Math.round(clamp01(a) * 255)
    .toString(16)
    .padStart(2, '0')}`

/** Light, base and dark tones of a hue, cached (a sphere is shaded with these). */
const toneCache = new Map<string, { hi: string; mid: string; lo: string }>()
const tones = (hue: string) => {
  let t = toneCache.get(hue)
  if (!t) toneCache.set(hue, (t = { hi: shade(hue, 0.42), mid: hue, lo: shade(hue, -0.5) }))
  return t
}
/** Logos drawn inside bubbles: loaded once, drawn when ready (a missing one just leaves the glyph). */
const logos = new Map<string, HTMLImageElement | null>()
function logoOf(url: string, onReady: () => void) {
  if (!logos.has(url)) {
    logos.set(url, null)
    const img = new Image()
    img.onload = () => {
      logos.set(url, img)
      onReady()
    }
    img.src = url
  }
  const img = logos.get(url)
  return img && img.complete && img.naturalWidth > 0 ? img : null
}

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
    drag: null as null | {
      x: number
      y: number
      moved: boolean
      pinch: number | null
    },
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
    bigAt: -1000,
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
    // A short, wide box (the embed's 340 px strip) has no overlays over the map: keep the margins small.
    const shortBox = wideBox && h < 420
    const padTop = shortBox ? 22 : wideBox ? 70 : 20
    const padBottom = shortBox ? 44 : wideBox ? (P.current.padBottom ?? 132) : 52
    const s = Math.max(0.05, Math.min((w - padX * 2) / Math.max(1, x1 - x0), (h - padTop - padBottom) / Math.max(1, y1 - y0)))
    return {
      x: (x0 + x1) / 2,
      y: (y0 + y1) / 2 - (padTop - padBottom) / 2 / s,
      s,
    }
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
        lift: 0,
        ox: 0,
        oy: 0,
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
      s.flows.push({
        e,
        start: s.clock + delay,
        n,
        dur: FLOW_MS,
        colour: sideColour(e.side),
        arrived: false,
        bend: hash(e.key) % 2 ? 1 : -1,
      })
      s.dirty = true
    },
    flyTo: (id) => flyToId(id),
    fit: () => fitView(),
    zoomBy: (f) => zoomAt(f, S.current.w / 2, S.current.h / 2),
  }))

  const flyToId = (id: string) => {
    const s = S.current
    const n = P.current.nodes.find((x) => x.id === id)
    if (!n) return
    s.userCam = true
    const target = {
      x: n.x,
      y: n.y,
      s: Math.max(s.fitCam.s * 2.2, Math.min(s.fitCam.s * 8, 60 / Math.max(1, n.r))),
    }
    s.camT = target
    if (P.current.reduced) s.cam = { ...target }
    setZoomed(true)
    s.dirty = true
  }
  const fitView = () => {
    const s = S.current
    s.userCam = false
    s.camT = { ...s.fitCam }
    if (P.current.reduced) s.cam = { ...s.fitCam }
    setZoomed(false)
    s.dirty = true
  }
  const zoomAt = (f: number, px: number, py: number) => {
    const s = S.current
    const c = s.camT
    const wx = c.x + (px - s.w / 2) / c.s
    const wy = c.y + (py - s.h / 2) / c.s
    const ns = Math.max(s.fitCam.s * 0.6, Math.min(s.fitCam.s * 14, c.s * f))
    s.camT = {
      s: ns,
      x: wx - (px - s.w / 2) / ns,
      y: wy - (py - s.h / 2) / ns,
    }
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
    const C = {
      pale: K.pale,
      bone: K.bone,
      gold: K.gold,
      night: K.night,
      muted: K.muted,
    }
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
      const kl = 1 - Math.exp(-dt / 110)
      const hv = s.hover ? s.states.get(s.hover) : undefined
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
        const targetA = st.dying !== null ? 0 : lit && !lit.has(id) ? 0.2 : 1
        const enterA = reduced ? clamp01(age / 450) : 1
        st.alpha += (targetA * enterA - st.alpha) * (reduced && age < 450 ? 1 : ka)
        st.pop = Math.max(0, st.pop - dt / 750)
        st.lift += ((s.hover === id && st.dying === null ? 1 : 0) - st.lift) * kl
        // Idle life: breathe and drift (screen pixels, so it reads the same at any zoom). Reduced motion keeps
        // the drift at a third of the speed and half the reach, and drops the breathing: slower, never still.
        let bx = 0
        let by = 0
        let br = 1
        if (st.dying === null && !(s.lite && st.r * cam.s < 14)) {
          const tt = reduced ? t * 0.33 : t
          if (!reduced) br = 1 + 0.03 * Math.sin((t / st.period) * Math.PI * 2 + st.phase)
          const amp = (reduced ? 1.6 : 3.8) / cam.s
          bx = Math.sin(tt / (st.period * 0.83) + st.phase) * amp
          by = Math.cos(tt / (st.period * 1.07) + st.phase * 1.3) * amp
        }
        // The hovered bubble lifts and its neighbours step aside (eased, so they spring back).
        let tx = 0
        let ty = 0
        if (hv && hv !== st && hv.lift > 0.01 && hv.dying === null) {
          const dx = st.x - hv.x
          const dy = st.y - hv.y
          const d = Math.hypot(dx, dy) || 1
          const reach = (hv.r + st.r) * 1.35 + 14
          if (d < reach) {
            const k = (1 - d / reach) * hv.lift * (reduced ? 0.5 : 1) * 11
            tx = (dx / d) * k
            ty = (dy / d) * k
          }
        }
        st.ox += (tx - st.ox) * kl
        st.oy += (ty - st.oy) * kl
        pos.set(id, {
          x: st.x + bx + st.ox / cam.s,
          y: st.y + by + st.oy / cam.s,
          r: Math.max(0, st.r * br * (1 + 0.1 * st.lift)),
          a: st.alpha,
          st,
        })
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      // Links (curved, their opacity follows the transfer count), then their idle particles.
      ctx.lineCap = 'round'
      let li = 0
      for (const l of p.links) {
        const a = pos.get(l.a)
        const b = pos.get(l.b)
        if (!a || !b) continue
        const on = !lit || (lit.has(l.a) && lit.has(l.b))
        const x0 = sx(a.x)
        const y0 = sy(a.y)
        const x1 = sx(b.x)
        const y1 = sy(b.y)
        const len = Math.hypot(x1 - x0, y1 - y0) || 1
        const bend = (hash(l.a + l.b) % 2 ? 1 : -1) * 0.13
        const cx = (x0 + x1) / 2 - ((y1 - y0) / len) * len * bend
        const cy = (y0 + y1) / 2 + ((x1 - x0) / len) * len * bend
        const al = Math.min(a.a, b.a, 1) * (on ? 0.2 + 0.5 * l.strength : 0.05) + (on && lit ? 0.22 : 0)
        ctx.strokeStyle = withAlpha(l.colour, al)
        ctx.lineWidth = l.width + (on && lit ? 0.8 : 0)
        ctx.setLineDash(l.dashed ? [4, 4] : [])
        ctx.beginPath()
        ctx.moveTo(x0, y0)
        ctx.quadraticCurveTo(cx, cy, x1, y1)
        ctx.stroke()
        if (!s.lite && l.particles && li < MAX_LINK_PARTICLES && on) {
          const u = ((reduced ? t * 0.33 : t) / 2600 + li * 0.37) % 1
          const px = (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * cx + u * u * x1
          const py = (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * cy + u * u * y1
          ctx.fillStyle = withAlpha(C.pale, 0.85 * Math.min(a.a, b.a))
          ctx.beginPath()
          ctx.arc(px, py, 1.8, 0, Math.PI * 2)
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
        return {
          x: w / 2 + Math.cos(ang) * R,
          y: h / 2 + Math.sin(ang) * R,
          r: 0,
        }
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

      // Bubbles: visible ones in screen units, biggest first (small ones sit on top), the hovered and the
      // selected one last. Each is a lit sphere; clusters get a halo behind them and a glow around them.
      const vis: {
        id: string
        n: BNode
        st: NodeState
        X: number
        Y: number
        R: number
        a: number
      }[] = []
      for (const [id, q] of pos) {
        const R = q.r * cam.s
        if (R < 0.3 || q.a < 0.01) continue
        const X = sx(q.x)
        const Y = sy(q.y)
        if (X + R < -40 || X - R > w + 40 || Y + R < -40 || Y - R > h + 40) continue
        vis.push({ id, n: q.st.node, st: q.st, X, Y, R, a: q.a })
      }
      const front = (v: { id: string }) => (v.id === s.hover || v.id === p.selected ? 1 : 0)
      vis.sort((x, y) => front(x) - front(y) || y.R - x.R)
      type Vis = (typeof vis)[number]

      // Cluster halos: a soft pool of the cluster's colour behind its members.
      const halos = new Map<string, Vis[]>()
      for (const v of vis) {
        if (!v.n.group) continue
        const list = halos.get(v.n.group)
        if (list) list.push(v)
        else halos.set(v.n.group, [v])
      }
      for (const items of halos.values()) {
        if (items.length < 2) continue
        let cx = 0
        let cy = 0
        let wt = 0
        let al = 0
        for (const v of items) {
          cx += v.X * v.R
          cy += v.Y * v.R
          wt += v.R
          al += v.a
        }
        cx /= wt
        cy /= wt
        al /= items.length
        let rad = 0
        for (const v of items) rad = Math.max(rad, Math.hypot(v.X - cx, v.Y - cy) + v.R)
        rad += 18
        const g = ctx.createRadialGradient(cx, cy, rad * 0.25, cx, cy, rad)
        g.addColorStop(0, withAlpha(items[0].n.hue, 0.17 * al))
        g.addColorStop(0.7, withAlpha(items[0].n.hue, 0.07 * al))
        g.addColorStop(1, withAlpha(items[0].n.hue, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(cx, cy, rad, 0, Math.PI * 2)
        ctx.fill()
      }

      // Soft pulse rings on pools, locks and the token (under the bubbles).
      if (!reduced)
        for (const v of vis) {
          if (!v.n.pulse || v.st.dying !== null) continue
          const ph = ((t + v.st.phase * 400) % 2600) / 2600
          ctx.globalAlpha = v.a
          ctx.strokeStyle = withAlpha(shade(v.n.hue, 0.35), 0.45 * (1 - ph))
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(v.X, v.Y, v.R + 2 + ph * Math.min(28, 10 + v.R * 0.25), 0, Math.PI * 2)
          ctx.stroke()
        }

      const drawBody = (g2: CanvasRenderingContext2D, v: Vis) => {
        const { X, Y, R, n } = v
        const tn = tones(n.hue)
        g2.globalAlpha = v.a
        if (n.glow && R >= 8) {
          const g = g2.createRadialGradient(X, Y, R * 0.85, X, Y, R * 1.7)
          g.addColorStop(0, withAlpha(n.hue, 0.34))
          g.addColorStop(1, withAlpha(n.hue, 0))
          g2.fillStyle = g
          g2.beginPath()
          g2.arc(X, Y, R * 1.7, 0, Math.PI * 2)
          g2.fill()
        }
        if (v.st.lift > 0.02) {
          const sy2 = Y + R * 0.22 + 7 * v.st.lift
          const g = g2.createRadialGradient(X, sy2, R * 0.7, X, sy2, R * 1.5)
          g.addColorStop(0, `rgba(0,0,0,${0.5 * v.st.lift})`)
          g.addColorStop(1, 'rgba(0,0,0,0)')
          g2.fillStyle = g
          g2.beginPath()
          g2.arc(X, sy2, R * 1.5, 0, Math.PI * 2)
          g2.fill()
        }
        if (R < 4) {
          g2.fillStyle = tn.mid
          g2.beginPath()
          g2.arc(X, Y, R, 0, Math.PI * 2)
          g2.fill()
          return
        }
        const g = g2.createRadialGradient(X - R * 0.34, Y - R * 0.4, R * 0.08, X, Y, R * 1.02)
        g.addColorStop(0, tn.hi)
        g.addColorStop(0.5, tn.mid)
        g.addColorStop(1, tn.lo)
        g2.fillStyle = g
        g2.beginPath()
        g2.arc(X, Y, R, 0, Math.PI * 2)
        g2.fill()
        if (R >= 9) {
          // A soft highlight, so the sphere reads as lit from the top left.
          g2.fillStyle = 'rgba(255,255,255,0.16)'
          g2.beginPath()
          g2.ellipse(X - R * 0.3, Y - R * 0.42, R * 0.34, R * 0.2, -0.6, 0, Math.PI * 2)
          g2.fill()
        }
        g2.strokeStyle = n.rim
        g2.lineWidth = n.rimWidth
        if (n.dashed) g2.setLineDash([5, 4])
        g2.beginPath()
        g2.arc(X, Y, R, 0, Math.PI * 2)
        g2.stroke()
        if (n.dashed) g2.setLineDash([])
        if (v.st.lift > 0.02) {
          g2.strokeStyle = withAlpha(C.bone, 0.75 * v.st.lift)
          g2.lineWidth = 2
          g2.beginPath()
          g2.arc(X, Y, R + 1.5, 0, Math.PI * 2)
          g2.stroke()
        }
      }
      const drawBodies = (g2: CanvasRenderingContext2D, items: Vis[]) => {
        for (const v of items) drawBody(g2, v)
        g2.globalAlpha = 1
      }
      // A slow device: small bubbles that have settled are drawn once into a layer, re-drawn only when the
      // camera, the lighting or the data changes; each frame then blits it and draws the rest.
      if (s.lite) {
        const settled = (v: Vis) => {
          const n = v.n
          return (
            v.R < 14 &&
            v.st.pop <= 0.01 &&
            v.st.lift < 0.01 &&
            v.st.dying === null &&
            p.selected !== v.id &&
            !p.ringed?.has(v.id) &&
            t - v.st.born > ENTER_MS &&
            Math.abs(v.st.x - n.x) < 0.01 &&
            Math.abs(v.st.y - n.y) < 0.01 &&
            Math.abs(v.st.r - n.r) < 0.01 &&
            Math.abs(v.a - Math.round(v.a * 20) / 20) < 0.01 &&
            Math.hypot(v.st.ox, v.st.oy) < 0.05
          )
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
            drawBodies(l2, still)
          }
          s.layerKey = key
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.drawImage(s.layer, 0, 0)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        const stillSet = new Set(still)
        drawBodies(
          ctx,
          vis.filter((v) => !stillSet.has(v)),
        )
      } else drawBodies(ctx, vis)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      let font = ''
      const setFont = (f: string) => {
        if (f !== font) ctx.font = font = f
      }
      let big: Vis | null = null
      for (const v of vis) {
        const { id, n, st, X, Y, R, a } = v
        if (!big || R > big.R) big = v
        ctx.globalAlpha = a
        if (p.selected === id) {
          ctx.strokeStyle = C.bone
          ctx.lineWidth = 3
          ctx.beginPath()
          ctx.arc(X, Y, R + 1, 0, Math.PI * 2)
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
        // Icon (or logo), share and kind, stacked and centred. A bubble too small for the stack drops the kind
        // first, then the share; the kind of every bubble is always in its tooltip and the list.
        const logo = n.logo && R >= 14 ? logoOf(n.logo, () => (s.dirty = true)) : null
        const showText = !!n.text && R >= 18
        const kind = R >= 30 ? (n.caption ?? n.kindText.toUpperCase()) : null
        const icon = (logo || n.glyph) && R >= 9
        const gs = icon ? Math.min(30, Math.max(10, R * (showText ? 0.4 : 0.9))) : 0
        const fs = showText ? Math.round(Math.min(24, Math.max(11, R * 0.28))) : 0
        const ks = kind ? 10 : 0
        const total = gs + fs + ks + (gs && (fs || ks) ? 3 : 0) + (fs && ks ? 2 : 0)
        let cy = Y - total / 2
        if (icon) {
          const gcy = cy + gs / 2
          if (logo) {
            ctx.save()
            ctx.beginPath()
            ctx.arc(X, gcy, gs / 2, 0, Math.PI * 2)
            ctx.clip()
            ctx.drawImage(logo, X - gs / 2, gcy - gs / 2, gs, gs)
            ctx.restore()
          } else if (n.glyph) {
            ctx.save()
            ctx.translate(X - gs / 2, gcy - gs / 2)
            ctx.scale(gs / 24, gs / 24)
            ctx.strokeStyle = n.textColour
            ctx.lineWidth = 2
            ctx.lineJoin = 'round'
            for (const g of glyphPaths(n.glyph)) ctx.stroke(g)
            ctx.restore()
          }
          cy += gs + 3
        }
        if (showText) {
          setFont(`600 ${fs}px 'IBM Plex Mono', monospace`)
          ctx.fillStyle = n.textColour
          ctx.fillText(n.text as string, X, cy + fs / 2)
          cy += fs + 2
        }
        if (kind) {
          setFont(`500 10px 'IBM Plex Mono', monospace`)
          ctx.fillStyle = n.textColour
          ctx.globalAlpha = a * 0.85
          ctx.fillText(kind, X, cy + 5)
          ctx.globalAlpha = a
        } else if (n.caption) {
          // Under the bubble, on a dark tab so it reads over neighbours.
          setFont(`500 11px 'IBM Plex Mono', monospace`)
          const tw = ctx.measureText(n.caption).width + 8
          ctx.fillStyle = withAlpha(C.night, 0.82)
          ctx.fillRect(X - tw / 2, Y + R + 3, tw, 15)
          ctx.fillStyle = C.muted
          ctx.fillText(n.caption, X, Y + R + 11)
        }
      }
      ctx.globalAlpha = 1
      // The biggest bubble's words and place, for checks and assistive tooling (twice a second).
      if (t - s.bigAt > 500) {
        s.bigAt = t
        const b = big as Vis | null
        box.dataset.big = b
          ? JSON.stringify({
              label: `${b.n.kindText} · ${b.n.text ?? ''}`.trim(),
              shown: b.R >= 30 || !!b.n.text,
              x: Math.round(b.X),
              y: Math.round(b.Y),
              r: Math.round(b.R),
            })
          : ''
        box.dataset.bodies = String(vis.length)
      }
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
        s.drag = {
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
          moved: true,
          pinch: Math.hypot(a.x - b.x, a.y - b.y),
        }
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
      s.camT = {
        ...s.camT,
        x: s.camT.x - dx / s.camT.s,
        y: s.camT.y - dy / s.camT.s,
      }
      s.cam = {
        ...s.cam,
        x: s.cam.x - dx / s.cam.s,
        y: s.cam.y - dy / s.cam.s,
      }
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
        // A click flies to the bubble; a click on empty space while zoomed flies back out.
        if (id) flyToId(id)
        else if (s.zoomed) fitView()
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
    <div ref={boxRef} className={`relative w-full overflow-hidden ${props.className ?? ''}`} style={{ height: props.height }} role="img" aria-label={props.label} data-chart="" data-bubble-canvas="" data-hover="" tabIndex={0} onKeyDown={onKeyDown}>
      {/* Its own compositing layer, so a frame repaints the canvas only, never the page around it. */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block size-full"
        style={{
          touchAction: 'pan-y',
          willChange: 'transform',
          contain: 'strict',
        }}
        aria-hidden
      />
      <div ref={tipRef} aria-hidden className="pointer-events-none absolute top-0 left-0 z-10 flex min-w-[160px] flex-col gap-0.5 rounded-[8px] border border-line-strong px-2.5 py-2 font-mono text-[12px] opacity-0 transition-opacity duration-150" style={{ background: K.midnight }} />
    </div>
  )
})

export default BubbleCanvas
