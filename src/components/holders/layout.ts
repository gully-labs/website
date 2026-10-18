/* The Holder Map's layout: a small deterministic force simulation (same map in, same picture out), run
   once in the browser. Bubbles repel and never overlap, linked wallets pull together, everything is held
   loosely round the centre where the token sits. Units are abstract; the chart fits them to its box. */

export interface LayoutNode {
  id: string
  /** Radius in layout units. */
  r: number
}
export interface Placed {
  id: string
  x: number
  y: number
  r: number
}

/** Radius for a share of supply: area follows the share, with a floor so the smallest wallets stay visible. */
export const radiusFor = (pct: number | null, maxPct: number, rMax = 46, rMin = 5) => Math.max(rMin, rMax * Math.sqrt(Math.max(0, pct ?? 0) / Math.max(maxPct, 1e-6)))

export function forceLayout(nodes: LayoutNode[], links: { source: string; target: string }[], iterations = 260): Placed[] {
  const n = nodes.length
  const idx = new Map(nodes.map((v, i) => [v.id, i]))
  // Start on a golden-angle spiral by rank: biggest near the middle.
  const x = new Float64Array(n)
  const y = new Float64Array(n)
  nodes.forEach((v, i) => {
    const a = i * 2.39996
    const d = 14 * Math.sqrt(i + 1) + v.r
    x[i] = Math.cos(a) * d
    y[i] = Math.sin(a) * d
  })
  const edges = links.map((l) => [idx.get(l.source), idx.get(l.target)]).filter((e): e is [number, number] => e[0] !== undefined && e[1] !== undefined)
  for (let it = 0; it < iterations; it++) {
    const alpha = 1 - it / iterations
    const vx = new Float64Array(n)
    const vy = new Float64Array(n)
    // Repulsion and collision.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = x[j] - x[i]
        let dy = y[j] - y[i]
        let d2 = dx * dx + dy * dy
        if (d2 < 0.01) {
          dx = 0.1 * ((i * 7 + j * 13) % 5) - 0.2
          dy = 0.1
          d2 = dx * dx + dy * dy
        }
        const d = Math.sqrt(d2)
        const min = nodes[i].r + nodes[j].r + 4
        let f = (220 * alpha) / d2
        if (d < min) f += ((min - d) / d) * 0.5
        vx[i] -= dx * f
        vy[i] -= dy * f
        vx[j] += dx * f
        vy[j] += dy * f
      }
    }
    // Springs along links.
    for (const [a, b] of edges) {
      const dx = x[b] - x[a]
      const dy = y[b] - y[a]
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01
      const rest = nodes[a].r + nodes[b].r + 18
      const f = ((d - rest) / d) * 0.06 * alpha
      vx[a] += dx * f
      vy[a] += dy * f
      vx[b] -= dx * f
      vy[b] -= dy * f
    }
    // Gravity to the centre.
    for (let i = 0; i < n; i++) {
      vx[i] -= x[i] * 0.012
      vy[i] -= y[i] * 0.012
      x[i] += Math.max(-30, Math.min(30, vx[i]))
      y[i] += Math.max(-30, Math.min(30, vy[i]))
    }
  }
  // A last pass that only separates overlaps.
  for (let pass = 0; pass < 40; pass++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = x[j] - x[i]
        const dy = y[j] - y[i]
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01
        const min = nodes[i].r + nodes[j].r + 3
        if (d < min) {
          const p = (min - d) / 2 / d
          x[i] -= dx * p
          y[i] -= dy * p
          x[j] += dx * p
          y[j] += dy * p
        }
      }
    }
  }
  return nodes.map((v, i) => ({ id: v.id, x: x[i], y: y[i], r: v.r }))
}

/** The square extent that holds every bubble with a margin, centred on the origin's side of the data. */
export function extentOf(placed: Placed[], pad = 12) {
  if (!placed.length) return { x0: -100, x1: 100, y0: -100, y1: 100 }
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
  return { x0: x0 - pad, x1: x1 + pad, y0: y0 - pad, y1: y1 + pad }
}
