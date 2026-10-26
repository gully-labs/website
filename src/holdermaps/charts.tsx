/* HolderMaps' charts: hand-written SVG in the kit colours, fed only by the map's own data (insights.ts) and the live
   Holder Map APIs. Each one animates in when it scrolls into view, tweens to new values on every refresh, and has a
   hover and keyboard read-out. Motion is transform and opacity only (60 fps); under prefers-reduced-motion the
   site's gentle policy holds: short fades and number changes stay, sweeps, growth and loops go. A value that cannot
   be read draws as "not readable", never as zero. */
import { useId, useMemo, useState, type ReactNode } from 'react'
import { forceLayout, radiusFor } from '../components/holders/layout'
import type { HolderMapOk } from '../lib/holders'
import { fmtInt, fmtPct, HM_C, isInfraNode, type Segment } from './insights'
import { useBoxWidth, useInView, useTween } from './hooks'

/* ------------------------------------------------------------- read-out --- */

/** Not readable: the chart's frame stays, with a pulsing marker and the reason (never a zero). */
export function NotReadable({ text, height = 120 }: { text: string; height?: number }) {
  return (
    <div className="hm-nr" style={{ minHeight: height }} role="status">
      <span className="hm-dot" aria-hidden />
      <span>{text}</span>
    </div>
  )
}

/* ---------------------------------------------------------------- gauge --- */

/** A half-ring gauge for a 0-100 share (the top-10 concentration). */
export function Gauge({ value, label, caption }: { value: number | null; label: string; caption: ReactNode }) {
  const [ref, seen] = useInView<HTMLDivElement>()
  const v = useTween(value ?? 0, seen && value !== null)
  const gid = useId().replace(/:/g, '')
  const level = value === null ? null : value >= 60 ? 'High' : value >= 30 ? 'Medium' : 'Low'
  return (
    <div ref={ref} className="hm-gauge" role="img" aria-label={value === null ? `${label}: not readable` : `${label}: ${fmtPct(value)} (${level} concentration)`}>
      <svg viewBox="0 0 200 116" aria-hidden>
        <defs>
          <linearGradient id={`g${gid}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={HM_C.lo} />
            <stop offset="1" stopColor={HM_C.hi} />
          </linearGradient>
        </defs>
        <path d="M20 100 A80 80 0 0 1 180 100" pathLength={100} className="hm-gauge-track" />
        {value !== null && <path d="M20 100 A80 80 0 0 1 180 100" pathLength={100} stroke={`url(#g${gid})`} className="hm-gauge-val" strokeDasharray={`${Math.max(0.01, v)} 100`} />}
        {[25, 50, 75].map((t) => {
          const a = Math.PI * (1 - t / 100)
          return <line key={t} x1={100 + 66 * Math.cos(a)} y1={100 - 66 * Math.sin(a)} x2={100 + 72 * Math.cos(a)} y2={100 - 72 * Math.sin(a)} className="hm-gauge-tick" />
        })}
        {value !== null && (
          <circle cx={100 + 80 * Math.cos(Math.PI * (1 - v / 100))} cy={100 - 80 * Math.sin(Math.PI * (1 - v / 100))} r={6} className="hm-gauge-knob" />
        )}
      </svg>
      <div className="hm-gauge-c">
        <b className="num">{value === null ? '—' : fmtPct(v)}</b>
        <span>{value === null ? 'not readable' : `${level} concentration`}</span>
      </div>
      <p className="hm-cap">{caption}</p>
    </div>
  )
}

/* ---------------------------------------------------------------- donut --- */

/** A donut of shares with a legend you can hover or tab through; the centre names the focused part. */
export function Donut({ segments, total = 100, centre, label }: { segments: Segment[]; total?: number; centre: { k: string; v: string }; label: string }) {
  const [ref, seen] = useInView<HTMLDivElement>()
  const p = useTween(1, seen, 1300)
  const [on, setOn] = useState<string | null>(null)
  const sumAll = Math.max(total, segments.reduce((a, s) => a + s.value, 0))
  const arcs = segments.map((s, i) => ({ ...s, start: segments.slice(0, i).reduce((a, x) => a + x.value, 0) / sumAll, len: s.value / sumAll }))
  const focus = arcs.find((a) => a.id === on) ?? null
  return (
    <div ref={ref} className="hm-donut">
      <svg viewBox="0 0 180 180" role="img" aria-label={`${label}: ${segments.map((s) => `${s.label} ${fmtPct(s.value)}`).join(', ')}`}>
        <circle cx="90" cy="90" r="68" className="hm-donut-track" />
        <g transform="rotate(-90 90 90)">
          {arcs.map((a) => (
            <circle
              key={a.id}
              cx="90"
              cy="90"
              r="68"
              pathLength={1000}
              className="hm-donut-seg"
              stroke={a.color}
              strokeDasharray={`${Math.max(0, a.len * 1000 * p - 4)} 1000`}
              strokeDashoffset={-a.start * 1000 * p}
              style={{ opacity: on && on !== a.id ? 0.28 : 1 }}
              onPointerEnter={() => setOn(a.id)}
              onPointerLeave={() => setOn(null)}
            />
          ))}
        </g>
      </svg>
      <div className="hm-donut-c" aria-live="polite">
        <b className="num">{focus ? fmtPct(focus.value) : centre.v}</b>
        <span>{focus ? focus.label : centre.k}</span>
      </div>
      <ul className="hm-legend">
        {segments.map((s) => (
          <li key={s.id}>
            <button type="button" onPointerEnter={() => setOn(s.id)} onPointerLeave={() => setOn(null)} onFocus={() => setOn(s.id)} onBlur={() => setOn(null)} aria-label={`${s.label}: ${fmtPct(s.value)}. ${s.note}`}>
              <i style={{ background: s.color }} aria-hidden />
              <span className="l">{s.label}</span>
              <span className="v num">{fmtPct(s.value)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* --------------------------------------------------------------- lorenz --- */

/** The Lorenz curve of the listed holders against perfect equality, with the Gini read-out and a crosshair. */
export function Lorenz({ points, gini, n }: { points: [number, number][]; gini: number; n: number }) {
  const [ref, seen] = useInView<HTMLDivElement>()
  const g = useTween(gini, seen)
  const [hover, setHover] = useState<[number, number] | null>(null)
  const W = 240
  const H = 200
  const P = 26
  const X = (x: number) => P + x * (W - P - 8)
  const Y = (y: number) => H - P - y * (H - P - 10)
  const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(y).toFixed(1)}`).join(' ')
  const area = `${d} L${X(1)} ${Y(1)} L${X(0)} ${Y(0)} Z`
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, ((e.clientX - r.left) / r.width) * W - P) / (W - P - 8))
    const pt = points.reduce((best, q) => (Math.abs(q[0] - x) < Math.abs(best[0] - x) ? q : best), points[0])
    setHover(pt)
  }
  return (
    <div ref={ref} className="hm-lorenz">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Lorenz curve of the ${n} listed holders. Gini ${gini.toFixed(2)}: ${gini >= 0.8 ? 'very unequal' : gini >= 0.6 ? 'unequal' : 'fairly spread'}.`} onPointerMove={move} onPointerLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75].map((t) => (
          <g key={t} className="hm-gl">
            <line x1={X(t)} x2={X(t)} y1={Y(0)} y2={Y(1)} />
            <line x1={X(0)} x2={X(1)} y1={Y(t)} y2={Y(t)} />
          </g>
        ))}
        <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} className="hm-eq" />
        <path d={area} className={`hm-lorenz-area ${seen ? 'in' : ''}`} />
        <path d={d} pathLength={1} className={`hm-lorenz-line ${seen ? 'in' : ''}`} />
        <text x={X(0)} y={H - 8} className="hm-ax">0%</text>
        <text x={X(1)} y={H - 8} className="hm-ax" textAnchor="end">
          holders →
        </text>
        <text x={6} y={Y(1) + 4} className="hm-ax">100%</text>
        {hover && (
          <g className="hm-cross">
            <line x1={X(hover[0])} x2={X(hover[0])} y1={Y(0)} y2={Y(1)} />
            <circle cx={X(hover[0])} cy={Y(hover[1])} r={4.5} />
          </g>
        )}
      </svg>
      <div className="hm-lorenz-r" aria-live="polite">
        <span className="k">Gini</span>
        <b className="num">{g.toFixed(2)}</b>
        <span className="s">{hover ? `The smallest ${Math.round(hover[0] * 100)}% of these holders hold ${fmtPct(hover[1] * 100)} of what they hold together` : `0 is perfectly even, 1 is one wallet holding all. Among the ${fmtInt(n)} holders on the map.`}</span>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- bars --- */

export interface BarRow {
  id: string
  label: ReactNode
  value: number | null
  sub?: ReactNode
  color?: string
  aria: string
}
/** Horizontal bars that grow in, staggered; a null value is "not readable", never a zero-length bar. */
export function Bars({ rows, fmt = fmtPct, max }: { rows: BarRow[]; fmt?: (v: number) => string; max?: number }) {
  const [ref, seen] = useInView<HTMLUListElement>()
  const top = max ?? Math.max(0.0001, ...rows.map((r) => r.value ?? 0))
  return (
    <ul ref={ref} className={`hm-bars ${seen ? 'in' : ''}`}>
      {rows.map((r, i) => (
        <li key={r.id} tabIndex={0} aria-label={r.aria} style={{ ['--d' as string]: `${i * 70}ms` }}>
          <span className="l">{r.label}</span>
          <span className="v num">{r.value === null ? 'not readable' : fmt(r.value)}</span>
          <span className="t" aria-hidden>
            {r.value !== null && <i style={{ width: `${Math.max(1.5, (r.value / top) * 100)}%`, background: r.color }} />}
          </span>
          {r.sub && <span className="s">{r.sub}</span>}
        </li>
      ))}
    </ul>
  )
}

/* ---------------------------------------------------------------- trend --- */

/** An area line over time (timeline frames) with a draw-in, a live end dot and a crosshair read-out. */
export function Trend({ values, labels, fmt, label, color = HM_C.yellow, height = 140 }: { values: (number | null)[]; labels: string[]; fmt: (v: number) => string; label: string; color?: string; height?: number }) {
  const [box, w] = useBoxWidth<HTMLDivElement>()
  const [ref, seen] = useInView<HTMLDivElement>()
  const [hi, setHi] = useState<number | null>(null)
  const gid = useId().replace(/:/g, '')
  const pts = useMemo(() => {
    const known = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null)
    const lo = Math.min(...known.map((p) => p[1]))
    const hiV = Math.max(...known.map((p) => p[1]))
    const span = hiV - lo || Math.max(1, Math.abs(hiV) * 0.1)
    const n = Math.max(1, values.length - 1)
    return known.map(([i, v]) => ({ i, v, x: 4 + (i / n) * (w - 8), y: 10 + (1 - (v - lo) / span) * (height - 34) }))
  }, [values, w, height])
  if (pts.length < 2) return <NotReadable text="Not enough history for a line yet" height={height} />
  const line = pts.map((p, k) => `${k ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const area = `${line} L${pts[pts.length - 1].x.toFixed(1)} ${height - 22} L${pts[0].x.toFixed(1)} ${height - 22} Z`
  const last = pts[pts.length - 1]
  const cur = hi === null ? null : pts.reduce((b, p) => (Math.abs(p.i - hi) < Math.abs(b.i - hi) ? p : b), pts[0])
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setHi(Math.round(((e.clientX - r.left) / r.width) * Math.max(1, values.length - 1)))
  }
  const key = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    setHi((h) => Math.min(values.length - 1, Math.max(0, (h ?? values.length - 1) + (e.key === 'ArrowLeft' ? -1 : 1))))
  }
  return (
    <div ref={box} className="hm-trend">
      <div ref={ref} tabIndex={0} onKeyDown={key} onBlur={() => setHi(null)} aria-label={`${label}. Use the arrow keys to read each point.`}>
        <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-label={`${label}: from ${fmt(pts[0].v)} (${labels[pts[0].i]}) to ${fmt(last.v)} (${labels[last.i]})`} onPointerMove={move} onPointerLeave={() => setHi(null)}>
          <defs>
            <linearGradient id={`t${gid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity=".32" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#t${gid})`} className={`hm-trend-area ${seen ? 'in' : ''}`} />
          <path d={line} pathLength={1} stroke={color} className={`hm-trend-line ${seen ? 'in' : ''}`} />
          <circle cx={last.x} cy={last.y} r={4} fill={color} className="hm-trend-end" />
          <circle cx={last.x} cy={last.y} r={4} fill="none" stroke={color} className="hm-trend-ping" />
          <text x={4} y={height - 6} className="hm-ax">
            {labels[pts[0].i]}
          </text>
          <text x={w - 4} y={height - 6} className="hm-ax" textAnchor="end">
            {labels[last.i]}
          </text>
          {cur && (
            <g className="hm-cross">
              <line x1={cur.x} x2={cur.x} y1={6} y2={height - 22} />
              <circle cx={cur.x} cy={cur.y} r={4.5} />
            </g>
          )}
        </svg>
      </div>
      <div className="hm-trend-r" aria-live="polite">
        {cur ? (
          <>
            <b className="num">{fmt(cur.v)}</b> <span>{labels[cur.i]}</span>
          </>
        ) : (
          <>
            <b className="num">{fmt(last.v)}</b> <span>latest · {labels[last.i]}</span>
          </>
        )}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------- bubble field --- */

/** A small live bubble map of one token's biggest holders (SVG): bubbles pop out of the centre, settle and breathe;
    linked wallets are joined; a refresh moves each bubble to its new size and place. Tap one for its share. */
export function BubbleField({ m, max = 36, height = 300, onPick }: { m: HolderMapOk; max?: number; height?: number; onPick?: (id: string) => void }) {
  const [box, w] = useBoxWidth<HTMLDivElement>(420)
  const [ref, seen] = useInView<HTMLDivElement>()
  const [hover, setHover] = useState<string | null>(null)
  const nodes = useMemo(() => m.nodes.filter((n) => typeof n.pct === 'number').slice(0, max), [m, max])
  const bigCluster = m.clusters[0]?.id ?? null
  const placed = useMemo(() => {
    const top = Math.max(0.0001, ...nodes.map((n) => n.pct ?? 0))
    const ids = new Set(nodes.map((n) => n.id))
    const links = m.links.filter((l) => ids.has(l.source) && ids.has(l.target))
    return { pts: forceLayout(nodes.map((n) => ({ id: n.id, r: radiusFor(n.pct, top, 46, 6) })), links, 220), links }
  }, [nodes, m.links])
  const fit = useMemo(() => {
    const ps = placed.pts
    if (!ps.length) return null
    const x0 = Math.min(...ps.map((p) => p.x - p.r))
    const x1 = Math.max(...ps.map((p) => p.x + p.r))
    const y0 = Math.min(...ps.map((p) => p.y - p.r))
    const y1 = Math.max(...ps.map((p) => p.y + p.r))
    const s = Math.min((w - 16) / (x1 - x0), (height - 16) / (y1 - y0))
    return { s, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }
  }, [placed, w, height])
  if (!fit) return <NotReadable text="No holder shares to draw for this token" height={height} />
  const at = new Map(placed.pts.map((p) => [p.id, { x: w / 2 + (p.x - fit.cx) * fit.s, y: height / 2 + (p.y - fit.cy) * fit.s, r: p.r * fit.s }]))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const hn = hover ? byId.get(hover) : null
  return (
    <div ref={box} className="hm-field" style={{ height }}>
      <div ref={ref} className={`hm-field-in ${seen ? 'in' : ''}`}>
        <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-label={`Bubble map of the ${nodes.length} largest holders of ${m.token.symbol ?? 'this token'}: the largest holds ${fmtPct(nodes[0]?.pct ?? 0)}.`}>
          <g className="hm-links">
            {placed.links.map((l) => {
              const a = at.get(l.source)
              const b = at.get(l.target)
              return a && b ? <line key={`${l.source}-${l.target}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} /> : null
            })}
          </g>
          {nodes.map((n, i) => {
            const p = at.get(n.id)
            if (!p) return null
            const infra = isInfraNode(n)
            const fill = infra ? HM_C.slate : n.cluster === bigCluster && bigCluster ? HM_C.yellow : n.cluster ? HM_C.lo : n.label?.kind === 'deployer' ? '#2f4a2e' : HM_C.carbon
            const stroke = infra ? HM_C.grey : n.cluster ? HM_C.hi : HM_C.muted
            return (
              <g key={n.id} className="hm-bub" style={{ ['--d' as string]: `${Math.min(i, 30) * 35}ms`, ['--b' as string]: `${(i % 7) * 0.45}s` }}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={Math.max(2, p.r)}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={hover === n.id ? 2.5 : 1.25}
                  tabIndex={-1}
                  onPointerEnter={() => setHover(n.id)}
                  onPointerLeave={() => setHover(null)}
                  onClick={() => onPick?.(n.id)}
                >
                  <title>{`#${n.rank} ${n.label?.name ?? n.short}: ${fmtPct(n.pct ?? 0)}`}</title>
                </circle>
                {p.r >= 20 && (
                  <text x={p.x} y={p.y} dy=".35em" textAnchor="middle" className={n.cluster && !infra ? 'on-y' : ''} style={{ fontSize: Math.round(Math.min(26, Math.max(10, p.r / 3))) }}>
                    {fmtPct(n.pct ?? 0)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      {hn && (
        <div className="hm-field-tip" role="status">
          <b>#{hn.rank}</b> {hn.label?.name ?? hn.short} · <span className="num">{fmtPct(hn.pct ?? 0)}</span>
          {hn.cluster ? ' · linked' : ''}
        </div>
      )}
    </div>
  )
}
