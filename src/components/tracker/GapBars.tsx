import { useState } from 'react'
import { ChainLogo, StockLogo } from './StockLogo'
import { DOWN, fmtGap, fmtPrice, UP, type TrackerRow } from '../../lib/tracker'

/* Every token's gap as a bar from a centre axis: right of centre trades above its fair price, left
   below. The ±in-line band is shaded so noise reads as noise. Bars grow out from the axis; thin
   pools are drawn hollow because their price is not trustworthy. Click a bar to open its history. */
export function GapBars({ rows, inLinePct, selected, onSelect }: { rows: TrackerRow[]; inLinePct: number; selected: string | null; onSelect: (id: string) => void }) {
  const [hover, setHover] = useState<string | null>(null)
  const id = (r: TrackerRow) => `${r.chain}:${r.ticker}`
  const multi = new Set(rows.map((r) => r.chain)).size > 1
  const [all, setAll] = useState(false)
  const TOP = 16
  const withGap = rows.filter((r) => r.gapPct !== null)
  // The widest gaps first so the chart stays compact; "show all" lists every stock.
  const widest = all ? withGap : [...withGap].sort((a, b) => Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0)).slice(0, TOP)
  const data = widest.sort((a, b) => (b.gapPct ?? 0) - (a.gapPct ?? 0))
  if (!data.length) return <p className="m-0 py-6 font-mono text-[12px] text-faint">No token has both a feed and a pool to compare yet.</p>
  const extent = Math.max(3, Math.ceil(Math.max(...data.map((r) => Math.abs(r.gapPct ?? 0))) * 1.15))
  const pct = (v: number) => (v / extent) * 50
  const ticks = [-extent, -extent / 2, 0, extent / 2, extent]

  return (
    <div className="flex flex-col gap-2">
      <div className="relative ml-[84px] h-4 font-mono text-[11px] text-axis" aria-hidden>
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2" style={{ left: `${50 + pct(t)}%` }}>
            {t > 0 ? '+' : ''}
            {Number.isInteger(t) ? t : t.toFixed(1)}%
          </span>
        ))}
      </div>
      <ul className="relative m-0 flex list-none flex-col gap-[3px] p-0" aria-label="Gap to fair price, by token">
        {/* the in-line band and the axis, behind the bars */}
        <li aria-hidden className="pointer-events-none absolute top-0 bottom-0 left-[84px] right-0">
          <span className="absolute inset-y-0 bg-[rgba(232,192,96,.06)]" style={{ left: `${50 - pct(inLinePct)}%`, width: `${pct(inLinePct) * 2}%` }} />
          <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
        </li>
        {data.map((r, i) => {
          const g = r.gapPct ?? 0
          const color = g >= 0 ? UP : DOWN
          const thin = r.status === 'thin'
          const active = selected === id(r) || hover === id(r)
          return (
            <li key={id(r)} className="relative">
              <button
                type="button"
                onClick={() => onSelect(id(r))}
                onMouseEnter={() => setHover(id(r))}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(id(r))}
                onBlur={() => setHover(null)}
                aria-pressed={selected === id(r)}
                aria-label={`${r.ticker} ${fmtGap(r.gapPct)}, onchain ${fmtPrice(r.onchain)}, fair ${fmtPrice(r.fair)}${thin ? ', thin pool' : ''}`}
                className={`grid h-[22px] w-full grid-cols-[104px_1fr] items-center gap-2 rounded-[4px] bg-transparent p-0 text-left transition-colors ${active ? 'bg-surface-hover' : ''}`}
              >
                <span className={`flex min-w-0 items-center justify-end gap-[6px] pr-1 font-mono text-[12px] ${selected === id(r) ? 'text-gold' : 'text-ink-2'}`}>
                  <StockLogo row={r} size={16} chainBadge={false} active={selected === id(r)} />
                  <span className="truncate">{r.ticker}</span>
                  {multi && <ChainLogo chain={r.chain} size={10} />}
                </span>
                <span className="relative h-full">
                  <span
                    className="absolute top-[4px] bottom-[4px] rounded-[2px]"
                    style={{
                      left: g >= 0 ? '50%' : `${50 + pct(g)}%`,
                      width: `${Math.max(0.4, Math.abs(pct(g)))}%`,
                      background: thin ? 'transparent' : color,
                      border: thin ? `1px dashed ${color}` : 'none',
                      opacity: active || !hover ? 1 : 0.45,
                      transformOrigin: g >= 0 ? 'left' : 'right',
                      animation: `gl-grow-x .7s ${Math.min(i * 0.025, 0.8)}s cubic-bezier(.2,.8,.2,1) both`,
                      transition: 'opacity .15s',
                    }}
                  />
                  <span
                    className="absolute top-1/2 -translate-y-1/2 font-mono text-[11px] whitespace-nowrap"
                    style={g >= 0 ? { left: `calc(${50 + Math.abs(pct(g))}% + 6px)`, color } : { right: `calc(${50 + Math.abs(pct(g))}% + 6px)`, color }}
                  >
                    {fmtGap(r.gapPct)}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {withGap.length > TOP && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 self-start bg-transparent p-0 font-mono text-[12px] text-gold hover:text-gold-hover">
          {all ? `Show the ${TOP} widest` : `Show all ${withGap.length}`}
        </button>
      )}
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-faint">
        <span className="inline-flex items-center gap-2">
          <i className="inline-block size-[10px] rounded-[2px]" style={{ background: UP }} /> above fair price
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="inline-block size-[10px] rounded-[2px]" style={{ background: DOWN }} /> below fair price
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="inline-block size-[10px] rounded-[2px] border border-dashed border-muted" /> thin pool, not trusted
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="inline-block h-[10px] w-4 bg-[rgba(232,192,96,.18)]" /> ±{inLinePct}% in line
        </span>
      </div>
    </div>
  )
}
