import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

/* Requests over time for the developer dashboard: an area for requests and a line for errors, a
   crosshair with a tooltip (mouse, touch or arrow keys) that breaks the bucket down per key.
   Self-contained on purpose: it takes plain points and draws hand-written SVG, so it can be swapped for
   another chart library later without touching the page. Only real counts are drawn; an all-zero range
   says so instead of pretending to be a trend. */

export interface ChartPoint {
  t: string
  total: number
  errors: number
  keys: Record<string, number>
}

interface Props {
  points: ChartPoint[]
  bucket: 'hour' | 'day'
  keyNames: Record<string, string>
  /** Show one key only (its requests; errors are not split per key). */
  keyFilter?: string | null
  height?: number
}

const PAD = { l: 44, r: 12, t: 14, b: 26 }

function niceMax(max: number): { top: number; step: number } {
  if (max <= 4) return { top: 4, step: 1 }
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  return { top: Math.ceil(max / step) * step, step }
}

const compact = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n))

export function UsageChart({ points, bucket, keyNames, keyFilter = null, height = 260 }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hoverAt, setHover] = useState<number | null>(null)
  const reduce = useReducedMotion()

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const value = (p: ChartPoint) => (keyFilter ? (p.keys[keyFilter] ?? 0) : p.total)
  const n = points.length
  const hover = hoverAt !== null && hoverAt < n ? hoverAt : null
  const max = Math.max(0, ...points.map(value))
  const { top, step } = niceMax(max)
  const innerW = Math.max(1, width - PAD.l - PAD.r)
  const innerH = height - PAD.t - PAD.b
  const x = (i: number) => PAD.l + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (v: number) => PAD.t + innerH - (v / top) * innerH

  const { line, area, errLine } = useMemo(() => {
    if (!n || !width) return { line: '', area: '', errLine: '' }
    const pts = points.map((p, i) => `${x(i).toFixed(1)},${y(value(p)).toFixed(1)}`)
    const l = 'M' + pts.join('L')
    const a = `${l}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`
    const e = 'M' + points.map((p, i) => `${x(i).toFixed(1)},${y(p.errors).toFixed(1)}`).join('L')
    return { line: l, area: a, errLine: e }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, width, height, top, keyFilter])

  const label = (iso: string, long = false) => {
    const d = new Date(iso)
    if (bucket === 'day') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    return long || n > 24 ? `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}` : time
  }

  // About five x labels, evenly spaced.
  const xTicks = useMemo(() => {
    if (n < 2) return n ? [0] : []
    const want = width < 480 ? 3 : 5
    const every = Math.max(1, Math.round((n - 1) / (want - 1)))
    const out: number[] = []
    for (let i = 0; i < n; i += every) out.push(i)
    if (out[out.length - 1] !== n - 1 && n - 1 - out[out.length - 1] < every / 2) out.pop()
    if (out[out.length - 1] !== n - 1) out.push(n - 1)
    return out
  }, [n, width])

  const yTicks: number[] = []
  for (let v = 0; v <= top + 1e-9; v += step) yTicks.push(v)

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - r.left
    const i = n <= 1 ? 0 : Math.round(((px - PAD.l) / innerW) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      setHover((h) => Math.max(0, Math.min(n - 1, (h ?? n - 1) + (e.key === 'ArrowLeft' ? -1 : 1))))
    } else if (e.key === 'Escape') setHover(null)
  }

  const empty = max === 0
  const cur = hover !== null ? points[hover] : null
  const breakdown = cur
    ? Object.entries(cur.keys)
        .filter(([id, v]) => v > 0 && (!keyFilter || id === keyFilter))
        .sort((a, b) => b[1] - a[1])
    : []
  const drawKey = `${points[0]?.t}-${n}-${keyFilter ?? 'all'}`
  const tipLeft = hover !== null ? Math.min(Math.max(x(hover), 90), width - 90) : 0
  const total = points.reduce((a, p) => a + value(p), 0)

  return (
    <div ref={wrap} className="relative w-full select-none" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={empty ? 'No requests in this range yet.' : `${total.toLocaleString('en-US')} requests in this range, at most ${max.toLocaleString('en-US')} per ${bucket}. Use the arrow keys to read each ${bucket}.`}
          tabIndex={0}
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
          className="block touch-pan-y rounded-input outline-offset-2"
        >
          <defs>
            <linearGradient id="gl-usage-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#e8c060" stopOpacity="0.32" />
              <stop offset="100%" stopColor="#e8c060" stopOpacity="0" />
            </linearGradient>
          </defs>
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={width - PAD.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? '#2c3540' : '#1a2029'} strokeDasharray={v === 0 ? undefined : '3 4'} />
              <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" className="fill-axis font-mono text-[10.5px]">
                {compact(v)}
              </text>
            </g>
          ))}
          {xTicks.map((i) => (
            <text key={i} x={x(i)} y={height - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="fill-axis font-mono text-[10.5px]">
              {label(points[i].t)}
            </text>
          ))}
          {!empty && (
            <g key={drawKey}>
              <motion.path d={area} fill="url(#gl-usage-fill)" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.25 }} />
              <motion.path d={line} fill="none" stroke="#e8c060" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }} />
              {!keyFilter && points.some((p) => p.errors > 0) && (
                <motion.path d={errLine} fill="none" stroke="#ff8a7a" strokeWidth={1.5} strokeDasharray="4 3" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 0.9 }} transition={{ duration: 0.5, delay: 0.6 }} />
              )}
            </g>
          )}
          {cur && hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={y(0)} stroke="#5c6878" strokeDasharray="2 3" />
              <circle cx={x(hover)} cy={y(value(cur))} r={4.5} fill="#0b0e13" stroke="#e8c060" strokeWidth={2} />
              {!keyFilter && cur.errors > 0 && <circle cx={x(hover)} cy={y(cur.errors)} r={3.5} fill="#0b0e13" stroke="#ff8a7a" strokeWidth={1.5} />}
            </g>
          )}
        </svg>
      )}
      {empty && width > 0 && (
        <div className="pointer-events-none absolute inset-x-0 flex items-center justify-center" style={{ top: PAD.t, height: innerH }}>
          <span className="rounded-input border border-line bg-surface-deep px-3 py-2 font-mono text-[12px] text-faint">No requests in this range yet.</span>
        </div>
      )}
      <AnimatePresence>
        {cur && hover !== null && (
          <motion.div
            key="tip"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="pointer-events-none absolute top-0 z-10 min-w-[160px] -translate-x-1/2 rounded-input border border-line-strong bg-surface-deep/95 px-3 py-2 font-mono text-[12px] text-ink shadow-[0_8px_24px_rgba(0,0,0,.45)] backdrop-blur"
            style={{ left: tipLeft }}
            role="status"
          >
            <div className="mb-1 text-faint">{bucket === 'day' ? `${label(cur.t)} (UTC)` : `${label(cur.t, true)}, 1 hour`}</div>
            <div className="flex justify-between gap-4">
              <span>
                <span className="text-gold">●</span> Requests
              </span>
              <b className="font-medium">{value(cur).toLocaleString('en-US')}</b>
            </div>
            {!keyFilter && (
              <div className="flex justify-between gap-4">
                <span>
                  <span className="text-error">●</span> Errors
                </span>
                <b className="font-medium">{cur.errors.toLocaleString('en-US')}</b>
              </div>
            )}
            {breakdown.length > 0 && !keyFilter && (
              <div className="mt-1 border-t border-line pt-1">
                {breakdown.map(([id, v]) => (
                  <div key={id} className="flex justify-between gap-4 text-muted">
                    <span className="max-w-[140px] truncate">{keyNames[id] ?? 'Key'}</span>
                    <span>{v.toLocaleString('en-US')}</span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
