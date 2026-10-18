import { Link } from 'react-router'
import { CHAIN_SHORT, DOWN, fmtGap, fmtPp, stockPath, UP, useMovers } from '../../lib/tracker'
import { StockLogo } from './StockLogo'

const W = 120
const H = 26

/** The window's gap as a sparkline path, scaled to its own range. */
function sparkPath(pts: [number, number][]): string {
  if (pts.length < 2) return ''
  const t0 = pts[0][0]
  const t1 = pts[pts.length - 1][0]
  const vs = pts.map((p) => p[1])
  const lo = Math.min(...vs)
  const span = Math.max(...vs) - lo || 1
  return pts.map((p, j) => `${j ? 'L' : 'M'}${(((p[0] - t0) / (t1 - t0 || 1)) * W).toFixed(1)},${(H - 2 - ((p[1] - lo) / span) * (H - 4)).toFixed(1)}`).join('')
}

/** A compact live row of the biggest 24h gap moves, each with its sparkline drawing in
    (/api/tracker/movers). Pulses while loading; says so when there is not enough history yet. */
export function MoversRow({ limit = 5 }: { limit?: number }) {
  const st = useMovers('24h', { limit })
  if (st.k === 'loading')
    return (
      <div aria-hidden className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2">
        {Array.from({ length: limit }, (_, i) => (
          <div key={i} className="h-[86px] gl-skeleton rounded-panel bg-surface" style={{ animationDelay: `${i * 0.12}s` }} />
        ))}
      </div>
    )
  if (st.k === 'error') return <p className="m-0 font-mono text-[12px] text-faint">The live movers could not be read just now.</p>
  const list = st.data.byGap.slice(0, limit)
  if (!list.length) return <p className="m-0 gl-skeleton font-mono text-[12px] text-faint">{st.data.note ?? 'Not tracked yet: the tracker needs 24h of snapshots.'}</p>
  return (
    <ul aria-label="Biggest gap moves, last 24 hours" className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2 p-0">
      {list.map((m, i) => {
        const c = m.gapChangePp === 0 ? '#a6b0bd' : m.gapChangePp > 0 ? UP : DOWN
        const d = sparkPath(m.spark)
        return (
          <li key={`${m.chain}:${m.ticker}`} style={{ animation: `gl-rise .45s ${i * 0.06}s ease both` }}>
            <Link to={stockPath(m)} title={`${m.ticker}: gap ${fmtGap(m.gapThen)} → ${fmtGap(m.gapNow)} over 24h`} className="flex min-h-11 flex-col gap-2 rounded-panel border border-line bg-surface p-3 text-ink transition-colors hover:border-gold hover:text-ink">
              <span className="flex items-center gap-2">
                <StockLogo row={m} size={22} chainBadge={false} />
                <b className="font-display text-[16px] leading-none">{m.ticker}</b>
                <span className="font-mono text-[11px] text-faint">{CHAIN_SHORT[m.chain] ?? m.chain}</span>
                <span className="ml-auto font-mono text-[12px] whitespace-nowrap" style={{ color: c }}>
                  {fmtPp(m.gapChangePp)}
                </span>
              </span>
              <svg aria-hidden width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block overflow-visible">
                {d && <path d={d} fill="none" stroke={c} strokeWidth={1.5} vectorEffect="non-scaling-stroke" pathLength={1} style={{ strokeDasharray: 1, animation: `gl-draw .9s ${0.2 + i * 0.06}s ease-out both` }} />}
              </svg>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
