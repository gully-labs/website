import { useEffect, useId, useRef, useState } from 'react'
import { projects } from '../content/projects'
import { fmtDay, fmtUsd, nameOf, type Point, type Venue } from '../lib/stats'

/* Charts drawn from live reads only. Lines draw on, bars grow from the baseline; each is
   interactive (hover crosshair with exact values, keyboard stepping) and has a table twin.
   All animation is off under prefers-reduced-motion (index.css). */

const grid =
  'repeating-linear-gradient(180deg,transparent 0,transparent calc(33.33% - 1px),#1a2029 calc(33.33% - 1px),#1a2029 33.33%)'

const accentOf = (key: string) => projects.find((p) => p.key === key)?.accent ?? '#e8c060'

function Tip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-input border border-line-strong bg-surface-deep px-[10px] py-2 font-mono text-[12px] whitespace-nowrap text-ink"
      style={{ left: x, top: y - 10, transform: 'translate(-50%, -100%)' }}
    >
      {children}
    </div>
  )
}

export function EmptySeries({ n }: { n: number }) {
  return (
    <p className="m-0 py-6 font-mono text-[12px] leading-[1.5] text-faint">
      {n} day{n === 1 ? '' : 's'} of data — not enough for a series yet.
    </p>
  )
}

/** Daily totals as an area line, last N days. */
export function DailyLine({ series, label, color = '#e8c060' }: { series: Point[]; label: string; color?: string }) {
  const gradientId = useId()
  const plot = useRef<HTMLDivElement>(null)
  const [idx, setIdx] = useState(-1)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = plot.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  if (series.length < 2) return <EmptySeries n={series.length} />
  const max = Math.max(...series.map((p) => p.v), 1e-9)
  const pts = series.map((p, i) => [(i / (series.length - 1)) * 100, 100 - (p.v / max) * 100] as const)
  const line = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' L')
  const step = Math.ceil(series.length / 7)
  const cur = idx >= 0 ? series[idx] : null

  return (
    <div
      className="flex min-h-[260px] gap-3 outline-offset-4"
      tabIndex={0}
      role="img"
      aria-label={`${label}: ${series.map((p) => `${fmtDay(p.t)} ${fmtUsd(p.v)}`).join(', ')}`}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          setIdx((i) => Math.min(series.length - 1, i < 0 ? 0 : i + 1))
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault()
          setIdx((i) => Math.max(0, i < 0 ? series.length - 1 : i - 1))
        } else if (e.key === 'Escape') setIdx(-1)
      }}
      onBlur={() => setIdx(-1)}
    >
      <div aria-hidden className="flex w-11 flex-none flex-col justify-between pb-[22px] text-right font-mono text-[11px] text-axis">
        {[max, (max * 2) / 3, max / 3, 0].map((v, i) => (
          <span key={i}>{fmtUsd(v)}</span>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div
          ref={plot}
          className="relative flex-1"
          style={{ background: grid }}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setIdx(Math.round(((e.clientX - r.left) / r.width) * (series.length - 1)))
          }}
          onMouseLeave={() => setIdx(-1)}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
            <defs>
              <linearGradient id={gradientId} x1={0} y1={0} x2={0} y2={1}>
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={`M0,100 L${line} L100,100 Z`} fill={`url(#${gradientId})`} style={{ animation: 'gl-fade 1.2s .6s ease both' }} />
            <path
              d={`M${line}`}
              fill="none"
              stroke={color}
              strokeWidth={2.5}
              vectorEffect="non-scaling-stroke"
              pathLength={1}
              strokeDasharray={1}
              style={{ animation: 'gl-draw 1.6s ease-out both' }}
            />
          </svg>
          {cur && (
            <>
              <div aria-hidden className="absolute top-0 bottom-0 w-px bg-line-hover" style={{ left: (idx / (series.length - 1)) * box.w }} />
              <div
                aria-hidden
                className="absolute size-[10px] -translate-1/2 rounded-full"
                style={{ left: (idx / (series.length - 1)) * box.w, top: (1 - cur.v / max) * box.h, background: color, boxShadow: `0 0 12px ${color}` }}
              />
              <Tip x={(idx / (series.length - 1)) * box.w} y={(1 - cur.v / max) * box.h}>
                {fmtDay(cur.t)}
                <br />
                <b className="font-medium text-gold">{fmtUsd(cur.v)}</b>
              </Tip>
            </>
          )}
        </div>
        <div aria-hidden className="relative h-4 font-mono text-[11px] text-axis">
          {series.map((p, i) =>
            i % step === 0 || i === series.length - 1 ? (
              <span
                key={p.t}
                className="absolute whitespace-nowrap"
                style={{ left: `${(i / (series.length - 1)) * 100}%`, transform: i === 0 ? 'none' : i === series.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}
              >
                {fmtDay(p.t)}
              </span>
            ) : null,
          )}
        </div>
      </div>
    </div>
  )
}

/** One bar per venue, from a picked figure; a venue without it says so instead of drawing zero. */
export function VenueBars({ venues, pick }: { venues: Venue[]; pick: (v: Venue) => number | null }) {
  const [hover, setHover] = useState<string | null>(null)
  const rows = projects.map((p) => {
    const v = venues.find((x) => x.key === p.key)
    const value = v && v.state === 'ok' ? pick(v) : null
    return { key: p.key, value, state: v?.state ?? 'error' }
  })
  const max = Math.max(...rows.map((r) => r.value ?? 0), 1e-9)
  return (
    <div className="relative flex h-[260px] items-stretch gap-[18px]">
      {rows.map((r, i) => (
        <div
          key={r.key}
          className="relative flex min-w-0 flex-1 flex-col gap-2"
          onMouseEnter={() => setHover(r.key)}
          onMouseLeave={() => setHover(null)}
          tabIndex={0}
          onFocus={() => setHover(r.key)}
          onBlur={() => setHover(null)}
          aria-label={`${nameOf(r.key)} ${r.value === null ? (r.state === 'error' ? 'could not be read' : 'not published') : fmtUsd(r.value)}`}
        >
          <div className="relative flex flex-1 items-end border-b border-line-strong">
            {r.value !== null ? (
              <div
                className="w-full rounded-t-[3px]"
                style={{
                  height: `${Math.max(2, (r.value / max) * 100)}%`,
                  background: accentOf(r.key),
                  transformOrigin: 'bottom',
                  animation: `gl-grow .7s ${i * 0.07}s cubic-bezier(.2,.8,.2,1) both`,
                }}
              />
            ) : (
              <span className="absolute inset-x-0 bottom-2 text-center font-mono text-[11px] text-faint">{r.state === 'error' ? 'unreadable' : 'not published'}</span>
            )}
          </div>
          <span className="font-mono text-[14px] text-ink">{r.value === null ? '—' : fmtUsd(r.value)}</span>
          <span className="truncate font-mono text-[11px] text-faint">{nameOf(r.key)}</span>
          {hover === r.key && (
            <Tip x={0} y={0}>
              <span className="absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap">
                {nameOf(r.key)} · {r.value === null ? (r.state === 'error' ? 'could not be read' : 'not published') : fmtUsd(r.value)}
              </span>
            </Tip>
          )}
        </div>
      ))}
    </div>
  )
}

/** The accessible twin of every chart. */
export function DataTable<T>({ rows, cols }: { rows: T[]; cols: { label: string; cell: (r: T) => React.ReactNode }[] }) {
  return (
    <div className="max-h-[260px] overflow-auto">
      <table className="w-full border-collapse font-mono text-[13px]">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.label} className="border-b border-line px-[10px] py-2 text-left text-[11px] font-medium tracking-[1px] text-faint">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c.label} className="border-b border-line px-[10px] py-2 text-ink-2">
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 rounded-input border border-line bg-bg p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-btn px-[14px] py-2 font-mono text-[12px] transition-colors ${value === o.id ? 'bg-gold text-bg' : 'bg-transparent text-muted hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
