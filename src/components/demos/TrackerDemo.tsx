import { useMemo, useRef, useState, type JSX } from 'react'
import { Link } from 'react-router'
import { STATUS_LABEL, stockPath, UP, DOWN, CHAIN_SHORT, fmtGap, fmtPrice, useHistory, useTracker, type HistoryPoint, type TrackerRow } from '../../lib/tracker'
import { StockLogo } from '../tracker/StockLogo'
import { StockSwap } from '../swap/StockSwap'

/* The tracker, in miniature: the live list of stock tokens, one stock's on-chain price against its
   Chainlink fair price over the last hour, day or week (the tracker's own five-minute recordings,
   GET /api/tracker/history), and the stock page's own swap card beside it. Everything is real; a
   price that could not be read is shown as such. The swap is the same component as on the stock
   page: geo check, notice, and the LI.FI chunk only after "I understand". */

type Range = '1H' | '24H' | '7D'
const SPAN: Record<Range, number> = { '1H': 3600, '24H': 86400, '7D': 7 * 86400 }
const W = 600
const H = 260
const MAX_POINTS = 160
const TRUSTED = new Set(['premium', 'discount', 'drifting', 'in-line'])

const tone = (r: Pick<TrackerRow, 'gapPct' | 'status'>) => (r.gapPct === null || r.status === 'thin' ? undefined : r.gapPct >= 0 ? UP : DOWN)
const pad2 = (n: number) => String(n).padStart(2, '0')
const when = (t: number, range: Range) => {
  const d = new Date(t * 1000)
  const hm = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`
  return range === '7D' ? `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} · ${hm}` : hm
}

/** Rows: trusted gaps first, widest first; the rest after, by ticker. */
function order(rows: TrackerRow[]) {
  const t = rows.filter((r) => TRUSTED.has(r.status) && r.gapPct !== null).sort((a, b) => Math.abs(b.gapPct!) - Math.abs(a.gapPct!))
  const rest = rows.filter((r) => !t.includes(r)).sort((a, b) => a.ticker.localeCompare(b.ticker))
  return [...t, ...rest]
}

/** The readings in range, thinned to at most MAX_POINTS, and the line split where readings are missing. */
function series(all: HistoryPoint[], range: Range) {
  if (!all.length) return { pts: [] as HistoryPoint[], breaks: new Set<number>() }
  const newest = all[all.length - 1][0]
  const inRange = all.filter((p) => p[0] >= newest - SPAN[range] && Number.isFinite(p[2]) && Number.isFinite(p[3]))
  const step = Math.max(1, Math.ceil(inRange.length / MAX_POINTS))
  const pts = inRange.filter((_, i) => i % step === 0 || i === inRange.length - 1)
  const dts = pts.slice(1).map((p, i) => p[0] - pts[i][0]).sort((a, b) => a - b)
  const typical = dts.length ? dts[Math.floor(dts.length / 2)] : 300
  const breaks = new Set<number>()
  pts.forEach((p, i) => i && p[0] - pts[i - 1][0] > Math.max(typical * 3, 900) && breaks.add(i))
  return { pts, breaks }
}

function Chart({ row, range }: { row: TrackerRow; range: Range }) {
  const st = useHistory(row.chain, row.ticker)
  const [hover, setHover] = useState<number | null>(null)
  const { pts, breaks } = useMemo(() => series(st.k === 'ok' ? st.data : [], range), [st, range])
  const N = pts.length

  if (st.k === 'loading') return <div className="m-[6px] h-[300px] animate-pulse rounded-[8px] bg-surface-deep" role="status" aria-label={`Reading ${row.ticker}'s history`} />
  if (st.k === 'error') return <p className="m-0 flex h-[300px] items-center justify-center px-4 font-mono text-[12px] text-error">{row.ticker}'s history could not be read. Try again in a minute.</p>
  if (N < 2)
    return (
      <p className="m-0 flex h-[300px] items-center justify-center px-6 text-center font-mono text-[12px] leading-[1.6] text-faint">
        {N} reading{N === 1 ? '' : 's'} in the last {range.toLowerCase()} — not enough for a line. The tracker records every stock every five minutes.
      </p>
    )

  const t0 = pts[0][0]
  const t1 = pts[N - 1][0]
  const vals = pts.flatMap((p) => [p[2], p[3]])
  let lo = Math.min(...vals)
  let hi = Math.max(...vals)
  const padY = (hi - lo) * 0.14 || hi * 0.01 || 1
  lo -= padY
  hi += padY
  const X = (t: number) => ((t - t0) / (t1 - t0 || 1)) * W
  const Y = (v: number) => H - 8 - ((v - lo) / (hi - lo)) * (H - 24)
  const path = (k: 2 | 3) => pts.map((p, i) => `${i === 0 || breaks.has(i) ? 'M' : 'L'}${X(p[0]).toFixed(1)} ${Y(p[k]).toFixed(1)}`).join(' ')
  const line = path(2)
  const area = `${line} L${W} ${H} L0 ${H} Z`
  const tip = hover === null ? null : pts[hover]

  const pick = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    const t = t0 + ((clientX - r.left) / r.width) * (t1 - t0)
    let best = 0
    for (let i = 1; i < N; i++) if (Math.abs(pts[i][0] - t) < Math.abs(pts[best][0] - t)) best = i
    setHover(best)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      setHover((h) => Math.max(0, Math.min(N - 1, (h ?? N - 1) + (e.key === 'ArrowRight' ? 1 : -1))))
    } else if (e.key === 'Escape') setHover(null)
  }
  const anim = { transition: 'd .7s cubic-bezier(.2,.8,.2,1)' }
  const last = pts[N - 1]

  return (
    <div
      className="relative flex-1 touch-pan-y px-[6px] pt-2 outline-none"
      tabIndex={0}
      role="img"
      aria-label={`${row.ticker} on-chain price against its Chainlink fair price, last ${range}: ${N} readings. Latest on chain ${fmtPrice(last[2])}, fair ${fmtPrice(last[3])}, gap ${fmtGap(last[1])}. Arrow keys step through readings.`}
      onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
      onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
      onPointerLeave={() => setHover(null)}
      onBlur={() => setHover(null)}
      onKeyDown={onKey}
    >
      <svg aria-hidden viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[300px] w-full">
        <defs>
          <linearGradient id="td-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e8c060" stopOpacity=".26" />
            <stop offset="1" stopColor="#e8c060" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g stroke="#1a2029">
          <line x1="0" y1="65" x2={W} y2="65" />
          <line x1="0" y1="130" x2={W} y2="130" />
          <line x1="0" y1="195" x2={W} y2="195" />
        </g>
        {breaks.size === 0 && <path d={area} fill="url(#td-area)" style={{ d: `path('${area}')`, ...anim } as React.CSSProperties} />}
        <path d={path(3)} fill="none" stroke="#8a96a6" strokeWidth={1.5} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" style={{ d: `path('${path(3)}')`, ...anim } as React.CSSProperties} />
        <path d={line} fill="none" stroke="#e8c060" strokeWidth={2.2} vectorEffect="non-scaling-stroke" style={{ d: `path('${line}')`, ...anim } as React.CSSProperties} />
        {/* A reading with no neighbour on either side (a gap in the recordings) is drawn as a dot. */}
        {pts.map((p, i) => ((i === 0 || breaks.has(i)) && (i === N - 1 || breaks.has(i + 1)) ? <circle key={p[0]} cx={X(p[0])} cy={Y(p[2])} r="2.5" fill="#e8c060" /> : null))}
        {tip && (
          <>
            <line x1={X(tip[0])} y1="0" x2={X(tip[0])} y2={H} stroke="#3a4452" vectorEffect="non-scaling-stroke" />
            <circle cx={X(tip[0])} cy={Y(tip[2])} r="4" fill="#e8c060" stroke="#10141a" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      <span className="pointer-events-none absolute top-2 right-3 font-mono text-[10px] text-faint">{fmtPrice(hi)}</span>
      <span className="pointer-events-none absolute right-3 bottom-1 font-mono text-[10px] text-faint">{fmtPrice(lo)}</span>
      {tip && (
        <div
          className="pointer-events-none absolute top-3 grid grid-cols-[auto_auto] gap-x-[14px] gap-y-[2px] rounded-[6px] border border-line-strong bg-[rgba(13,17,22,.96)] px-[10px] py-2 font-mono text-[11px]"
          style={{ left: `${(X(tip[0]) / W) * 100}%`, transform: `translateX(${X(tip[0]) > W * 0.6 ? '-105%' : '10px'})` }}
        >
          <span className="col-span-full text-faint">{when(tip[0], range)}</span>
          <span className="text-gold">on chain</span>
          <span>{fmtPrice(tip[2])}</span>
          <span className="text-muted">fair</span>
          <span>{fmtPrice(tip[3])}</span>
          <span className="text-muted">gap</span>
          <span style={{ color: tip[1] >= 0 ? UP : DOWN }}>{fmtGap(tip[1])}</span>
        </div>
      )}
    </div>
  )
}

export default function TrackerDemo(): JSX.Element {
  const st = useTracker()
  const [sel, setSel] = useState<string | null>(null)
  const [range, setRange] = useState<Range>('24H')
  const listRef = useRef<HTMLDivElement>(null)

  const card = 'overflow-hidden rounded-card border border-line bg-surface'
  if (st.k === 'loading') return <div className={`${card} h-[560px] animate-pulse`} role="status" aria-label="Reading the tracker" />
  if (st.k === 'error')
    return (
      <div className={`${card} flex h-[240px] items-center justify-center p-6`}>
        <p className="m-0 font-mono text-[13px] text-error">The tracker could not be read just now. It retries every minute.</p>
      </div>
    )

  const rows = order(st.data.rows)
  const keyOf = (r: TrackerRow) => `${r.chain}:${r.ticker}`
  const row = rows.find((r) => keyOf(r) === sel) ?? rows[0]
  if (!row)
    return (
      <div className={`${card} flex h-[240px] items-center justify-center p-6`}>
        <p className="m-0 font-mono text-[13px] text-faint">No stock is tracked right now.</p>
      </div>
    )
  const c = tone(row)
  const idx = rows.indexOf(row)

  const onListKey = (e: React.KeyboardEvent) => {
    const k = e.key
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(k)) return
    e.preventDefault()
    const next = k === 'Home' ? 0 : k === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, idx + (k === 'ArrowDown' ? 1 : -1)))
    setSel(keyOf(rows[next]))
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-i="${next}"]`)?.focus())
  }

  return (
    <div className={`${card} flex flex-wrap text-[13px] leading-[1.45]`}>
      {/* Stock list */}
      <div className="flex min-w-0 flex-[1_1_210px] flex-col gap-[2px] border-line p-2 min-[720px]:border-r max-[719px]:border-b">
        <span className="px-2 py-[6px] font-mono text-[10px] tracking-[1px] text-faint">
          STOCK · GAP <span className="text-faint">({rows.length})</span>
        </span>
        <div ref={listRef} role="listbox" aria-label="Stock tokens" onKeyDown={onListKey} className="flex max-h-[470px] flex-col gap-[2px] overflow-y-auto overscroll-contain max-[719px]:max-h-[232px]">
          {rows.map((r, i) => {
            const on = r === row
            const tc = tone(r)
            return (
              <button
                key={keyOf(r)}
                type="button"
                role="option"
                aria-selected={on}
                data-i={i}
                tabIndex={on ? 0 : -1}
                onClick={() => setSel(keyOf(r))}
                className={`grid min-h-11 grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 rounded-[8px] px-2 text-left text-ink transition-colors ${on ? 'bg-grid' : 'bg-transparent hover:bg-surface-hover'}`}
              >
                <StockLogo row={r} size={26} active={on} />
                <span className="flex min-w-0 flex-col leading-[1.15]">
                  <b className="font-semibold">{r.ticker}</b>
                  <span className="truncate font-mono text-[10px] text-faint">{CHAIN_SHORT[r.chain] ?? r.chain}</span>
                </span>
                <span className="font-mono text-[12px]" style={{ color: tc }}>
                  {r.gapPct === null ? <span className="text-faint">{STATUS_LABEL[r.status].toLowerCase()}</span> : fmtGap(r.gapPct)}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Chart */}
      <div className="flex min-w-0 flex-[999_1_420px] flex-col">
        <div className="flex flex-wrap items-center gap-[10px] border-b border-line px-[14px] py-3">
          <b className="font-display text-[26px] leading-none font-bold">{row.ticker}</b>
          <span className="font-mono text-[16px]">{row.onchain === null ? <span className="text-faint">price unreadable</span> : fmtPrice(row.onchain)}</span>
          <span
            className="rounded-[4px] px-2 py-[2px] font-mono text-[12px] transition-colors duration-300"
            style={{ color: c ?? '#a6b0bd', background: c ? `${c}26` : '#1a2029' }}
          >
            {row.gapPct === null ? STATUS_LABEL[row.status] : `gap ${fmtGap(row.gapPct)} · ${STATUS_LABEL[row.status].toLowerCase()}`}
          </span>
          <div role="tablist" aria-label="Range" className="ml-auto flex gap-[2px] rounded-[6px] border border-line p-[2px]">
            {(['1H', '24H', '7D'] as Range[]).map((r) => (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={range === r}
                onClick={() => setRange(r)}
                className={`min-h-9 min-w-11 rounded-[4px] font-mono text-[11px] transition-colors ${range === r ? 'bg-gold text-bg' : 'bg-transparent text-muted hover:text-ink'}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <Chart key={keyOf(row)} row={row} range={range} />
        <div className="flex flex-wrap justify-between gap-2 px-[14px] pt-2 pb-3 font-mono text-[10px] text-faint">
          <span className="flex gap-[14px]">
            <span className="flex items-center gap-[6px]">
              <span className="h-[2px] w-3 bg-gold" />
              deepest pool
            </span>
            <span className="flex items-center gap-[6px]">
              <span className="w-3 border-t-2 border-dashed border-dim" />
              Chainlink fair
            </span>
          </span>
          <span>Live · recorded every five minutes · fair {row.fair === null ? 'unreadable' : fmtPrice(row.fair)}</span>
        </div>
      </div>

      {/* Swap: the stock page's own card */}
      <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 border-line p-6 min-[720px]:border-l max-[719px]:border-t">
        <div className="flex items-center justify-between">
          <b className="font-display text-[20px] font-bold uppercase">Swap {row.ticker}</b>
          <span className="font-mono text-[10px] text-faint">LI.FI</span>
        </div>
        <StockSwap key={keyOf(row)} row={row} />
        <Link to={stockPath(row)} className="mt-auto inline-flex min-h-11 items-center text-[13px] text-gold hover:text-gold-hover">
          Open the {row.ticker} page →
        </Link>
      </div>
    </div>
  )
}
