import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { LIMITED_COLOR } from './styles'

/* Hand-drawn SVG charts for the console portal: a sparkline, the stacked request bars, the double
   ring and a meter. They stay SVG (not ECharts) so the portal chunk stays small, but move like the
   site's chart kit: bars grow in with a small stagger and glide to new heights, lines draw left to
   right and end on a pulsing live dot, rings sweep, meters fill; hovering a bucket lights its column
   with a crosshair while the others dim, and the tooltip follows. Under prefers-reduced-motion the
   index.css policy turns the growth into short fades and stills the pulse. They draw only the
   numbers they are given: no smoothing, no sample data. */

const EASE = 'cubic-bezier(.2,.8,.2,1)'

/** A small trend line. `values` empty draws nothing; all zero draws a flat line on the floor. */
export function Spark({ values, color, w = 80, h = 28, label }: { values: number[]; color: string; w?: number; h?: number; label?: string }) {
  if (values.length < 2) return <span aria-hidden className="inline-block" style={{ width: w, height: h }} />
  const max = Math.max(...values)
  const px = (i: number) => (i / (values.length - 1)) * (w - 4)
  const py = (v: number) => (max ? (1 - v / max) * (h - 6) + 3 : h - 3)
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(' ')
  const lx = px(values.length - 1)
  const ly = py(values[values.length - 1])
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="block shrink-0 overflow-visible" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path key={d} d={d} pathLength={1} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" style={{ strokeDasharray: 1, animation: `gl-draw 1.3s ${EASE} both` }} />
      <circle cx={lx} cy={ly} r={2.2} fill={color} style={{ animation: 'gl-fade .3s 1.1s both' }} />
      <circle cx={lx} cy={ly} r={2.2} fill="none" stroke={color} strokeWidth={1} style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: 'gl-live-pulse 2.4s 1.4s ease-out infinite both' }} />
    </svg>
  )
}

export interface BarSeries {
  id: string
  name: string
  color: string
}

export interface BarColumn {
  /** Short label for the axis, long one for the tooltip. */
  label: string
  long: string
  /** Requests per series id. */
  values: Record<string, number>
  total: number
  /** 429 answers in the bucket (already inside `total`); undefined when the server does not say. */
  limited?: number
}

const compact = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n))
const fmt = (n: number) => n.toLocaleString('en-US')

function niceTop(max: number) {
  if (max <= 4) return 4
  const raw = max / 3
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  return Math.ceil(max / step) * step
}

/**
 * Requests per bucket, stacked by key. 429s are drawn as a red tick at the height of the bucket's
 * rate-limited count (they are part of the keys' bars, not on top of them). Hover, tap or focus and use
 * the arrow keys to read a bucket.
 */
export function RequestBars({ columns, series, showLimited, animKey, height = 240 }: { columns: BarColumn[]; series: BarSeries[]; showLimited: boolean; animKey: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const tipId = useId()
  const W = 720
  const H = 220
  const n = columns.length
  const max = Math.max(0, ...columns.map((c) => c.total))
  const top = niceTop(max)
  const slot = W / Math.max(1, n)
  const bw = Math.max(1, slot * 0.62)
  const y = (v: number) => H - (v / top) * (H - 6)
  const cur = hover !== null && hover < n ? columns[hover] : null
  const empty = max === 0
  const sum = columns.reduce((a, c) => a + c.total, 0)

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      setHover((h) => Math.max(0, Math.min(n - 1, (h ?? n) + (e.key === 'ArrowLeft' ? -1 : 1))))
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setHover(e.key === 'Home' ? 0 : n - 1)
    } else if (e.key === 'Escape') setHover(null)
  }

  const leftPct = hover !== null ? ((hover + 0.5) / n) * 100 : 0
  return (
    <div
      className="relative rounded-[8px] outline-offset-2"
      tabIndex={0}
      role="group"
      aria-label={empty ? 'No requests in this range yet.' : `${fmt(sum)} requests in this range, at most ${fmt(max)} in one bucket. Use the left and right arrow keys to read each bucket.`}
      aria-describedby={cur ? tipId : undefined}
      onKeyDown={onKey}
      onBlur={() => setHover(null)}
      onMouseLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full touch-pan-y" style={{ height }} aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <line key={i} x1={0} x2={W} y1={y((top / 3) * i)} y2={y((top / 3) * i)} stroke={i ? '#1a2029' : '#2c3540'} vectorEffect="non-scaling-stroke" />
        ))}
        {hover !== null && hover < n && (
          <g aria-hidden pointerEvents="none">
            <rect x={hover * slot} y={0} width={slot} height={H} fill="rgba(166,176,189,.06)" />
            <line x1={hover * slot + slot / 2} x2={hover * slot + slot / 2} y1={0} y2={H} stroke="#3a4452" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          </g>
        )}
        <g key={animKey}>
          {columns.map((c, i) => {
            let acc = 0
            const x = i * slot + (slot - bw) / 2
            const dim = hover !== null && hover !== i
            return (
              <g key={i} opacity={dim ? 0.35 : 1} style={{ transition: 'opacity .15s' }} onMouseEnter={() => setHover(i)} onPointerDown={() => setHover(i)}>
                <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
                {series.map((s) => {
                  const v = c.values[s.id] ?? 0
                  if (!v) return null
                  const y0 = y(acc)
                  acc += v
                  const y1 = y(acc)
                  return (
                    <rect
                      key={s.id}
                      x={x}
                      y={y1}
                      width={bw}
                      height={Math.max(0.5, y0 - y1)}
                      fill={s.color}
                      style={{ transformBox: 'fill-box', transformOrigin: 'center bottom', animation: `gl-grow .7s ${EASE} ${(i * 0.018).toFixed(3)}s both`, transition: `y .5s ${EASE}, height .5s ${EASE}` }}
                    />
                  )
                })}
                {showLimited && !!c.limited && <rect x={x - 1} y={y(c.limited) - 1.5} width={bw + 2} height={3} rx={1} fill={LIMITED_COLOR} style={{ animation: `gl-fade .4s ${(0.4 + i * 0.018).toFixed(3)}s both` }} />}
              </g>
            )
          })}
        </g>
      </svg>
      <span className="pointer-events-none absolute top-0 left-1 font-mono text-[10px] text-faint">{compact(top)}</span>
      {empty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-[8px] border border-line bg-surface-deep px-3 py-2 font-mono text-[12px] text-faint">No requests in this range yet</span>
        </div>
      )}
      {cur && hover !== null && (
        <div
          id={tipId}
          role="status"
          className="pointer-events-none absolute top-1 z-10 grid grid-cols-[auto_auto] gap-x-[14px] gap-y-[2px] rounded-[8px] border border-line-strong bg-[rgba(13,17,22,.96)] px-[10px] py-2 font-mono text-[11px] whitespace-nowrap text-ink shadow-[0_8px_24px_rgba(0,0,0,.45)]"
          style={{ left: `${leftPct}%`, transform: `translateX(${hover > n * 0.55 ? 'calc(-100% - 10px)' : '10px'})`, transition: 'left .12s ease-out' }}
        >
          <span className="text-faint">{cur.long}</span>
          <span />
          {series
            .filter((s) => (cur.values[s.id] ?? 0) > 0)
            .map((s) => (
              <Row key={s.id} color={s.color} name={s.name} value={fmt(cur.values[s.id] ?? 0)} />
            ))}
          <Row color="#a6b0bd" name="all keys" value={fmt(cur.total)} />
          {showLimited && <Row color={LIMITED_COLOR} name="of which 429" value={fmt(cur.limited ?? 0)} />}
        </div>
      )}
    </div>
  )
}

function Row({ color, name, value }: { color: string; name: string; value: string }) {
  return (
    <>
      <span className="max-w-[160px] truncate" style={{ color }}>
        {name}
      </span>
      <span className="text-right">{value}</span>
    </>
  )
}

/** Two concentric progress rings (0–100 each); they sweep in from zero. */
export function DoubleRing({ outer, inner, size = 132, children, label }: { outer: number | null; inner: number | null; size?: number; children: ReactNode; label: string }) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true))
    return () => cancelAnimationFrame(id)
  }, [])
  const dash = (v: number | null) => `${on && v !== null ? Math.max(0, Math.min(100, v)) : 0} 100`
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={label} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={60} cy={60} r={48} fill="none" stroke="#1a2029" strokeWidth={10} />
        {outer !== null && outer >= 1 && <circle cx={60} cy={60} r={48} fill="none" stroke="#e8c060" strokeWidth={10} strokeLinecap="round" pathLength={100} strokeDasharray={dash(outer)} style={{ transition: `stroke-dasharray 1.3s ${EASE}` }} />}
        <circle cx={60} cy={60} r={34} fill="none" stroke="#1a2029" strokeWidth={8} />
        {inner !== null && inner >= 1 && <circle cx={60} cy={60} r={34} fill="none" stroke="#6aa6ff" strokeWidth={8} strokeLinecap="round" pathLength={100} strokeDasharray={dash(inner)} style={{ transition: `stroke-dasharray 1.3s ${EASE} .15s` }} />}
      </svg>
      <span className="absolute inset-0 grid place-items-center text-center">{children}</span>
    </div>
  )
}

/** A thin horizontal meter that fills from zero. */
export function Meter({ value, max, label, tone }: { value: number; max: number; label: string; tone?: string }) {
  const [on, setOn] = useState(false)
  const ref = useRef(0)
  useEffect(() => {
    ref.current = requestAnimationFrame(() => setOn(true))
    return () => cancelAnimationFrame(ref.current)
  }, [])
  const pct = Math.min(100, (value / Math.max(1, max)) * 100)
  const color = tone ?? (pct >= 100 ? '#ff8a7a' : '#e8c060')
  return (
    <span className="block h-2 overflow-hidden rounded-[4px] bg-grid" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <span className="block h-full rounded-[4px]" style={{ width: on ? `${pct}%` : 0, background: color, transition: `width .6s ${EASE}` }} />
    </span>
  )
}
