import { useMemo } from 'react'
import { Link } from 'react-router'
import { CHAIN_SHORT, DOWN, fmtGap, fmtPp, stockPath, UP, useMovers, type Mover } from '../../lib/tracker'
import { EChart } from '../charts/EChart'
import { C, sparklinePreset } from '../charts/chartPresets'
import { StockLogo } from './StockLogo'
import { GhostChart } from '../charts/GhostChart'

const H = 32
const hhmm = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** What the movers show before there is enough history: a ghost chart where the lines will draw, with the
    server's own words under it (muted ink, 4.5:1 or better) instead of faint text on a shimmer. */
export function MoversEmpty({ note, height = 96 }: { note: string; height?: number }) {
  return (
    <GhostChart testId="movers-empty" height={height} badge={false} label="Movers will draw here">
      <span className="font-mono text-[12px] leading-[1.45] text-muted" data-testid="movers-empty-note">{note}</span>
    </GhostChart>
  )
}

/** The window's gap as a live sparkline (the shared chart kit): it draws in when scrolled into view,
    animates to the new points on each re-read, and hovering shows the gap at that reading. */
function MoverSpark({ m, color }: { m: Mover; color: string }) {
  const option = useMemo(
    () => sparklinePreset({ data: m.spark.map((p) => p[1]), labels: m.spark.map((p) => hhmm(p[0])), color, area: true, fmt: (v) => fmtGap(v) }),
    [m.spark, color],
  )
  if (m.spark.length < 2) return <span aria-hidden className="block gl-skeleton rounded-[4px] bg-surface-deep" style={{ height: H }} />
  return <EChart option={option} height={H} label={`${m.ticker} gap over the last 24 hours, ${fmtGap(m.gapThen)} to ${fmtGap(m.gapNow)}`} skeleton="line" />
}

/** A compact live row of the biggest 24h gap moves, each with its live sparkline (shared EChart kit)
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
  if (!list.length) return <MoversEmpty note={st.data.note ?? 'Not tracked yet: the Stock tracker needs 24h of snapshots.'} />
  return (
    <ul aria-label="Biggest gap moves, last 24 hours" className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2 p-0">
      {list.map((m, i) => {
        const c = m.gapChangePp === 0 ? C.muted : m.gapChangePp > 0 ? UP : DOWN
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
              <MoverSpark m={m} color={c} />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
