import { useEffect, useId, useRef, useState } from 'react'
import { DOWN, fmtGap, fmtPrice, UP, useHistory, type HistoryPoint } from '../../lib/tracker'

type Range = '24h' | '7d'
type Mode = 'gap' | 'price'

const when = (t: number, range: Range) =>
  new Date(t * 1000).toLocaleString('en-US', range === '24h' ? { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' } : { month: 'short', day: 'numeric', hour: '2-digit', hour12: false, timeZone: 'UTC' })

function useBox() {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, box] as const
}

/* One token's history, recorded by this site every five minutes: the gap over time, or the two
   prices side by side. Crosshair on hover, arrow keys step through points, and the range toggles
   between the last day and the last week. A short history says how short instead of drawing. */
export function GapHistory({ chain, ticker, inLinePct }: { chain: string; ticker: string; inLinePct: number }) {
  const st = useHistory(chain, ticker)
  const [range, setRange] = useState<Range>('24h')
  const [mode, setMode] = useState<Mode>('gap')
  const [idx, setIdx] = useState(-1)
  const [ref, box] = useBox()
  const gid = useId()

  const all = st.k === 'ok' ? st.data : []
  // The window ends at the newest reading, not the wall clock: rendering stays pure, and a paused
  // tracker still shows its last day rather than an empty one.
  const newest = all.length ? all[all.length - 1][0] : 0
  const since = newest - (range === '24h' ? 86400 : 7 * 86400)
  const pts: HistoryPoint[] = all.filter((p) => p[0] >= since)

  const seg = (on: boolean) => `rounded-btn px-3 py-[6px] font-mono text-[12px] transition-colors ${on ? 'bg-gold text-bg' : 'bg-transparent text-muted hover:text-ink'}`
  const controls = (
    <div className="flex flex-wrap gap-2">
      <div role="group" aria-label="Show" className="flex gap-1 rounded-input border border-line bg-bg p-1">
        <button type="button" aria-pressed={mode === 'gap'} onClick={() => setMode('gap')} className={seg(mode === 'gap')}>
          Gap
        </button>
        <button type="button" aria-pressed={mode === 'price'} onClick={() => setMode('price')} className={seg(mode === 'price')}>
          Prices
        </button>
      </div>
      <div role="group" aria-label="Range" className="flex gap-1 rounded-input border border-line bg-bg p-1">
        {(['24h', '7d'] as Range[]).map((r) => (
          <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)} className={seg(range === r)}>
            {r}
          </button>
        ))}
      </div>
    </div>
  )

  let body: React.ReactNode
  if (st.k === 'loading') body = <p className="m-0 py-10 font-mono text-[12px] text-faint">Reading {ticker}'s history…</p>
  else if (st.k === 'error') body = <p className="m-0 py-10 font-mono text-[12px] text-error">The history could not be read. Try again.</p>
  else if (pts.length < 2)
    body = (
      <p className="m-0 py-10 font-mono text-[12px] leading-[1.6] text-faint">
        {pts.length} reading{pts.length === 1 ? '' : 's'} in this range. The tracker records every token every five minutes, so a line appears after two readings.
      </p>
    )
  else {
    const t0 = pts[0][0]
    const t1 = pts[pts.length - 1][0]
    const x = (t: number) => (t1 === t0 ? 50 : ((t - t0) / (t1 - t0)) * 100)
    let lo: number, hi: number
    if (mode === 'gap') {
      const ext = Math.max(inLinePct * 1.5, ...pts.map((p) => Math.abs(p[1]))) * 1.15
      lo = -ext
      hi = ext
    } else {
      const vals = pts.flatMap((p) => [p[2], p[3]])
      const a = Math.min(...vals)
      const b = Math.max(...vals)
      const pad = (b - a || b * 0.01) * 0.15
      lo = a - pad
      hi = b + pad
    }
    const y = (v: number) => 100 - ((v - lo) / (hi - lo)) * 100
    const line = (k: 1 | 2 | 3) => pts.map((p) => `${x(p[0]).toFixed(2)},${y(p[k]).toFixed(2)}`).join(' L')
    const cur = idx >= 0 ? pts[Math.min(idx, pts.length - 1)] : null
    const last = pts[pts.length - 1]
    const gapColor = last[1] >= 0 ? UP : DOWN
    body = (
      <div
        className="flex min-h-[240px] gap-3 outline-offset-4"
        tabIndex={0}
        role="img"
        aria-label={`${ticker} ${mode === 'gap' ? 'gap to fair price' : 'onchain and fair price'}, last ${range}. Latest ${fmtGap(last[1])}.`}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            e.preventDefault()
            setIdx((i) => Math.min(pts.length - 1, i < 0 ? 0 : i + 1))
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault()
            setIdx((i) => Math.max(0, i < 0 ? pts.length - 1 : i - 1))
          } else if (e.key === 'Escape') setIdx(-1)
        }}
        onBlur={() => setIdx(-1)}
      >
        <div aria-hidden className="flex w-14 flex-none flex-col justify-between pb-[22px] text-right font-mono text-[11px] text-axis">
          {[hi, (hi + lo) / 2, lo].map((v, i) => (
            <span key={i}>{mode === 'gap' ? fmtGap(v) : fmtPrice(v)}</span>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div
            ref={ref}
            className="relative flex-1"
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              const t = t0 + ((e.clientX - r.left) / r.width) * (t1 - t0)
              let best = 0
              pts.forEach((p, i) => {
                if (Math.abs(p[0] - t) < Math.abs(pts[best][0] - t)) best = i
              })
              setIdx(best)
            }}
            onMouseLeave={() => setIdx(-1)}
          >
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
              <defs>
                <linearGradient id={gid} x1={0} y1={0} x2={0} y2={1}>
                  <stop offset="0%" stopColor={gapColor} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={gapColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              {mode === 'gap' ? (
                <>
                  <rect x={0} width={100} y={y(inLinePct)} height={y(-inLinePct) - y(inLinePct)} fill="rgba(232,192,96,.07)" />
                  <line x1={0} x2={100} y1={y(0)} y2={y(0)} stroke="#2c3540" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  <path d={`M0,${y(0)} L${line(1)} L100,${y(0)} Z`} fill={`url(#${gid})`} style={{ animation: 'gl-fade 1s .5s ease both' }} />
                  <path d={`M${line(1)}`} fill="none" stroke={gapColor} strokeWidth={2} vectorEffect="non-scaling-stroke" pathLength={1} strokeDasharray={1} style={{ animation: 'gl-draw 1.4s ease-out both' }} />
                </>
              ) : (
                <>
                  <path d={`M${line(3)}`} fill="none" stroke="#a6b0bd" strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" style={{ animation: 'gl-fade .8s ease both' }} />
                  <path d={`M${line(2)}`} fill="none" stroke="#e8c060" strokeWidth={2} vectorEffect="non-scaling-stroke" pathLength={1} strokeDasharray={1} style={{ animation: 'gl-draw 1.4s ease-out both' }} />
                </>
              )}
            </svg>
            {cur && box.w > 0 && (
              <>
                <div aria-hidden className="absolute top-0 bottom-0 w-px bg-line-hover" style={{ left: (x(cur[0]) / 100) * box.w }} />
                <div
                  aria-hidden
                  className="absolute size-[9px] -translate-1/2 rounded-full"
                  style={{ left: (x(cur[0]) / 100) * box.w, top: (y(mode === 'gap' ? cur[1] : cur[2]) / 100) * box.h, background: mode === 'gap' ? (cur[1] >= 0 ? UP : DOWN) : '#e8c060', boxShadow: '0 0 10px currentColor' }}
                />
                <div
                  className="pointer-events-none absolute z-10 rounded-input border border-line-strong bg-surface-deep px-[10px] py-2 font-mono text-[12px] whitespace-nowrap text-ink"
                  style={{ left: Math.min(Math.max((x(cur[0]) / 100) * box.w, 70), box.w - 70), top: 0, transform: 'translate(-50%, -105%)' }}
                >
                  <div className="text-faint">{when(cur[0], range)} UTC</div>
                  <div>
                    gap <b className="font-medium" style={{ color: cur[1] >= 0 ? UP : DOWN }}>{fmtGap(cur[1])}</b>
                  </div>
                  <div>
                    onchain <b className="font-medium text-gold">{fmtPrice(cur[2])}</b> · fair {fmtPrice(cur[3])}
                  </div>
                </div>
              </>
            )}
          </div>
          <div aria-hidden className="flex justify-between font-mono text-[11px] text-axis">
            <span>{when(t0, range)}</span>
            <span>{when(t1, range)} UTC</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-[12px] text-faint">
          {mode === 'gap' ? 'Gap to fair price' : <><span className="text-gold">━ onchain</span> · <span className="text-muted">┅ fair (Chainlink)</span></>}
        </span>
        {controls}
      </div>
      {body}
    </div>
  )
}
