import { useEffect, useMemo, useRef } from 'react'
import { useReducedMotion } from '../charts/chart-utils'
import { forceLayout, radiusFor } from './layout'
import { sideColour, type FlowSide } from './motion'
import { K } from './theme'

/* A launch's Holder Map in miniature for the /holders feed (its own lazy chunk): the biggest bubbles from the
   cached map (GET /api/holders/launches `preview`), breathing, the pool pulsing, and the launch's latest real
   transfers streaming between them in turn (gold buys, red sells). Drawn on a small canvas only while it is
   on screen; under reduced motion it is a still picture that fades in. */

export interface MapPreview {
  nodes: { p: number; k: 'pool' | 'lock' | 'burn' | 'deployer' | 'cluster' | 'wallet' | 'infra' }[]
  flows: { f: number; t: number; s: FlowSide }[]
}

const fillOf = (k: MapPreview['nodes'][number]['k']) => (k === 'cluster' ? K.gold : k === 'deployer' ? K.moss : k === 'wallet' ? K.midnight : K.slate)
const strokeOf = (k: MapPreview['nodes'][number]['k']) => (k === 'pool' || k === 'lock' ? K.pale : k === 'wallet' ? K.muted : K.dim)

export function MiniMap({ preview, width = 76, height = 56, label }: { preview: MapPreview; width?: number; height?: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const reduced = useReducedMotion()
  const placed = useMemo(() => {
    const max = Math.max(0.0001, ...preview.nodes.map((n) => n.p))
    return forceLayout(
      preview.nodes.map((n, i) => ({ id: String(i), r: radiusFor(n.p, max, 46, 7) })),
      [],
      120,
    )
  }, [preview])

  useEffect(() => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx || !placed.length) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = Math.round(width * dpr)
    c.height = Math.round(height * dpr)
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (const p of placed) {
      x0 = Math.min(x0, p.x - p.r)
      x1 = Math.max(x1, p.x + p.r)
      y0 = Math.min(y0, p.y - p.r)
      y1 = Math.max(y1, p.y + p.r)
    }
    const s = Math.min((width - 6) / (x1 - x0), (height - 6) / (y1 - y0))
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    const X = (x: number) => (x - cx) * s + width / 2
    const Y = (y: number) => (y - cy) * s + height / 2
    let raf = 0
    let visible = false
    let clock = 0
    let last = 0
    const draw = (dt: number) => {
      clock += dt
      const t = clock
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      const grow = reduced ? 1 : Math.min(1, t / 800)
      const at = placed.map((p, i) => {
        const ph = i * 1.7
        const br = reduced ? 1 : 1 + 0.04 * Math.sin(t / 650 + ph)
        return { x: X(p.x * (reduced ? 1 : 1 - Math.pow(1 - grow, 3))) + (reduced ? 0 : Math.sin(t / 900 + ph) * 0.8), y: Y(p.y * (reduced ? 1 : 1 - Math.pow(1 - grow, 3))) + (reduced ? 0 : Math.cos(t / 1100 + ph) * 0.8), r: Math.max(1.2, p.r * s * grow * br) }
      })
      preview.nodes.forEach((n, i) => {
        const q = at[i]
        if ((n.k === 'pool' || n.k === 'lock') && !reduced) {
          const ph = (t % 2400) / 2400
          ctx.strokeStyle = `${K.pale}${Math.round(0.45 * (1 - ph) * 255).toString(16).padStart(2, '0')}`
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(q.x, q.y, q.r + 1 + ph * 6, 0, Math.PI * 2)
          ctx.stroke()
        }
        ctx.fillStyle = fillOf(n.k)
        ctx.strokeStyle = strokeOf(n.k)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      })
      // One real transfer at a time, in turn: a short stream of dots from sender to receiver.
      if (!reduced && preview.flows.length && grow >= 1) {
        const CYCLE = 1900
        const k = Math.floor(t / CYCLE) % preview.flows.length
        const f = preview.flows[k]
        const u0 = (t % CYCLE) / 1300
        const edge = (i: number) => ({ x: i % 2 ? width + 4 : -4, y: height * (0.2 + ((i * 37) % 60) / 100) })
        const a = f.f >= 0 ? at[f.f] : f.s === 'buy' ? at[0] : edge(k)
        const b = f.t >= 0 ? at[f.t] : f.s === 'sell' ? at[0] : edge(k + 1)
        if (a && b) {
          for (let j = 0; j < 4; j++) {
            const u = u0 - j * 0.08
            if (u <= 0 || u >= 1) continue
            const e = 0.5 - Math.cos(Math.PI * u) / 2
            ctx.fillStyle = sideColour(f.s)
            ctx.globalAlpha = 1 - j * 0.2
            ctx.beginPath()
            ctx.arc(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e, 1.6, 0, Math.PI * 2)
            ctx.fill()
          }
          ctx.globalAlpha = 1
        }
      }
    }
    const frame = (now: number) => {
      const dt = Math.min(50, now - last)
      last = now
      draw(dt)
      raf = visible && !document.hidden && !reduced ? requestAnimationFrame(frame) : 0
    }
    const start = () => {
      if (raf || !visible || document.hidden) return
      if (reduced) {
        draw(0)
        return
      }
      last = performance.now()
      raf = requestAnimationFrame(frame)
    }
    const io = new IntersectionObserver((es) => {
      visible = es.some((e) => e.isIntersecting)
      if (visible) start()
    })
    io.observe(c)
    const onVis = () => start()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      cancelAnimationFrame(raf)
    }
  }, [placed, preview, reduced, width, height])

  return <canvas ref={ref} role="img" aria-label={label} className="block flex-none animate-[gl-fade_.4s_ease_both] rounded-[8px]" style={{ width, height, background: K.night }} data-mini-map />
}

export default MiniMap
