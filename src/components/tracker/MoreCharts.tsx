import { useState } from 'react'
import { CHAIN_NAME, DOWN, fmtCompactUsd, fmtGap, fmtPrice, UP, type TrackerRow } from '../../lib/tracker'

const trusted = (rows: TrackerRow[]) => rows.filter((r) => r.gapPct !== null && r.status !== 'thin')
const tip = 'pointer-events-none absolute z-10 rounded-input border border-line-strong bg-surface-deep px-[10px] py-2 font-mono text-[12px] whitespace-nowrap text-ink'
const median = (v: number[]) => {
  if (!v.length) return null
  const s = [...v].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

/* How far stock tokens sit from fair: a histogram in quarter-percent bins, the outer bins catching
   everything beyond. Bars rise from the baseline; hover a bin for its count and its tickers. */
export function GapHistogram({ rows }: { rows: TrackerRow[] }) {
  const [hover, setHover] = useState(-1)
  const t = trusted(rows)
  const edges = [-Infinity, -1.5, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.5, Infinity]
  const bins = edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1]
    const items = t.filter((r) => (r.gapPct ?? 0) >= lo && (r.gapPct ?? 0) < hi)
    const label = lo === -Infinity ? `< ${hi}%` : hi === Infinity ? `≥ +${lo}%` : `${lo > 0 ? '+' : ''}${lo}`
    return { lo, hi, items, label }
  })
  const max = Math.max(1, ...bins.map((b) => b.items.length))
  if (!t.length) return <p className="m-0 py-6 font-mono text-[12px] text-faint">No trusted pools to plot yet.</p>
  const cur = hover >= 0 ? bins[hover] : null
  return (
    <div className="flex flex-col gap-2">
      <div className="relative flex h-[150px] items-end gap-[4px] border-b border-line-strong" role="img" aria-label={`Gap distribution: ${bins.map((b) => `${b.label} ${b.items.length}`).join(', ')}`}>
        {bins.map((b, i) => {
          const center = b.lo >= -0.25 && b.hi <= 0.25 ? '#a6b0bd' : b.lo >= 0 ? UP : DOWN
          return (
            <div key={i} tabIndex={0} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)} onFocus={() => setHover(i)} onBlur={() => setHover(-1)} className="flex h-full flex-1 items-end outline-offset-1">
              <div
                className="w-full rounded-t-[3px] transition-opacity"
                style={{ height: `${(b.items.length / max) * 100}%`, minHeight: b.items.length ? 3 : 0, background: center, opacity: hover < 0 || hover === i ? 1 : 0.4, transformOrigin: 'bottom', animation: `gl-grow .7s ${i * 0.04}s cubic-bezier(.2,.8,.2,1) both` }}
              />
            </div>
          )
        })}
        {cur && (
          <div className={`${tip} top-1 -translate-x-1/2`} style={{ left: `${Math.min(85, Math.max(15, ((hover + 0.5) / bins.length) * 100))}%` }}>
            <div className="text-faint">{cur.label}{Number.isFinite(cur.lo) && Number.isFinite(cur.hi) ? ` to ${cur.hi > 0 ? '+' : ''}${cur.hi}%` : ''}</div>
            <div>
              <b className="font-medium text-gold">{cur.items.length}</b> stock{cur.items.length === 1 ? '' : 's'}
            </div>
            {cur.items.length > 0 && <div className="max-w-[220px] truncate text-faint">{cur.items.map((r) => r.ticker).join(' ')}</div>}
          </div>
        )}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-axis" aria-hidden>
        <span>below fair</span>
        <span>0%</span>
        <span>above fair</span>
      </div>
    </div>
  )
}

/* Pool depth against gap: does a thin pool drift further? x is liquidity on a log scale, y the gap,
   bubble area the 24h volume. Points pop in; hover for the stock, click to open its history. */
export function LiquidityScatter({ rows, onSelect }: { rows: TrackerRow[]; onSelect: (id: string) => void }) {
  const [hover, setHover] = useState<string | null>(null)
  const pts = rows.filter((r) => r.gapPct !== null && r.pool && r.pool.liquidityUsd > 0)
  if (pts.length < 2) return <p className="m-0 py-6 font-mono text-[12px] text-faint">Not enough pools to plot yet.</p>
  const lx = (v: number) => Math.log10(Math.max(v, 1))
  const xs = pts.map((r) => lx(r.pool!.liquidityUsd))
  const x0 = Math.floor(Math.min(...xs))
  const x1 = Math.ceil(Math.max(...xs))
  const ext = Math.max(1.5, ...pts.map((r) => Math.abs(r.gapPct ?? 0))) * 1.15
  const vmax = Math.max(1, ...pts.map((r) => r.pool!.totalVolume24hUsd))
  const X = (r: TrackerRow) => ((lx(r.pool!.liquidityUsd) - x0) / Math.max(1, x1 - x0)) * 100
  const Y = (r: TrackerRow) => 50 - ((r.gapPct ?? 0) / ext) * 50
  const R = (r: TrackerRow) => 4 + Math.sqrt(r.pool!.totalVolume24hUsd / vmax) * 12
  const cur = pts.find((r) => `${r.chain}:${r.ticker}` === hover)
  const ticks = Array.from({ length: x1 - x0 + 1 }, (_, i) => x0 + i)
  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-[190px] border-b border-l border-line-strong" style={{ background: 'linear-gradient(transparent calc(50% - .5px), #2c3540 calc(50% - .5px), #2c3540 calc(50% + .5px), transparent calc(50% + .5px))' }}>
        <span className="absolute top-1 left-2 font-mono text-[10px] text-axis">+{ext.toFixed(1)}%</span>
        <span className="absolute bottom-1 left-2 font-mono text-[10px] text-axis">−{ext.toFixed(1)}%</span>
        {pts.map((r, i) => {
          const id = `${r.chain}:${r.ticker}`
          const thin = r.status === 'thin'
          const c = (r.gapPct ?? 0) >= 0 ? UP : DOWN
          return (
            <button
              key={id}
              type="button"
              aria-label={`${r.ticker}: liquidity ${fmtCompactUsd(r.pool!.liquidityUsd)}, gap ${fmtGap(r.gapPct)}`}
              onMouseEnter={() => setHover(id)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(id)}
              onBlur={() => setHover(null)}
              onClick={() => onSelect(id)}
              className="absolute -translate-1/2 rounded-full p-0"
              style={{
                left: `${X(r)}%`,
                top: `${Y(r)}%`,
                width: R(r) * 2,
                height: R(r) * 2,
                background: thin ? 'transparent' : `${c}55`,
                border: `1.5px ${thin ? 'dashed' : 'solid'} ${c}`,
                opacity: hover && hover !== id ? 0.35 : 1,
                animation: `gl-pop .5s ${Math.min(i * 0.02, 0.7)}s cubic-bezier(.3,1.4,.5,1) both`,
                transition: 'opacity .15s',
              }}
            />
          )
        })}
        {cur && (
          <div className={`${tip} -translate-x-1/2`} style={{ left: `${Math.min(80, Math.max(20, X(cur)))}%`, top: `${Y(cur) > 50 ? Y(cur) - 34 : Y(cur) + 6}%` }}>
            <div>
              <b className="font-medium text-gold">{cur.ticker}</b> · {CHAIN_NAME[cur.chain] ?? cur.chain}
            </div>
            <div>
              gap <span style={{ color: (cur.gapPct ?? 0) >= 0 ? UP : DOWN }}>{fmtGap(cur.gapPct)}</span> · {fmtPrice(cur.onchain)}
            </div>
            <div className="text-faint">
              liquidity {fmtCompactUsd(cur.pool!.liquidityUsd)} · vol {fmtCompactUsd(cur.pool!.totalVolume24hUsd)}
            </div>
          </div>
        )}
      </div>
      <div className="relative h-4 font-mono text-[10px] text-axis" aria-hidden>
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2" style={{ left: `${((t - x0) / Math.max(1, x1 - x0)) * 100}%` }}>
            {fmtCompactUsd(10 ** t)}
          </span>
        ))}
      </div>
      <span className="font-mono text-[10px] text-faint">pool liquidity (log scale) · bubble size = 24h volume · dashed = thin pool</span>
    </div>
  )
}

/* Where the liquidity is: a ring of the deepest stock pools, each arc drawing in. Hover an arc or a
   legend row for its share. */
export function LiquidityRing({ rows }: { rows: TrackerRow[] }) {
  const [hover, setHover] = useState<string | null>(null)
  const withPool = rows.filter((r) => r.pool && r.pool.totalLiquidityUsd > 0).sort((a, b) => b.pool!.totalLiquidityUsd - a.pool!.totalLiquidityUsd)
  const total = withPool.reduce((a, r) => a + r.pool!.totalLiquidityUsd, 0)
  if (!total) return <p className="m-0 py-6 font-mono text-[12px] text-faint">No pool liquidity to show yet.</p>
  const palette = ['#e8c060', '#1f9e89', '#5aa9e6', '#c98bdb', '#e4572e', '#9bc53d', '#f4d98c', '#6c7888']
  const top = withPool.slice(0, 7).map((r, i) => ({ id: `${r.chain}:${r.ticker}`, label: r.ticker, chain: r.chain, v: r.pool!.totalLiquidityUsd, color: palette[i] }))
  const rest = total - top.reduce((a, s) => a + s.v, 0)
  const slices = rest > 0 ? [...top, { id: 'other', label: `${withPool.length - top.length} others`, chain: '', v: rest, color: '#3a4452' }] : top
  const C = 2 * Math.PI * 40
  // Each arc's start, computed up front so rendering stays pure.
  const offsets = slices.map((_, i) => slices.slice(0, i).reduce((a, s) => a + (s.v / total) * C, 0))
  const cur = slices.find((s) => s.id === hover)
  return (
    <div className="flex items-center gap-5 max-[480px]:flex-col">
      <svg viewBox="0 0 100 100" className="size-[150px] flex-none -rotate-90" role="img" aria-label={slices.map((s) => `${s.label} ${((s.v / total) * 100).toFixed(1)}%`).join(', ')}>
        <circle cx={50} cy={50} r={40} fill="none" stroke="#1d232c" strokeWidth={14} />
        {slices.map((s, i) => {
          const len = (s.v / total) * C
          return (
            <circle
              key={s.id}
              cx={50}
              cy={50}
              r={40}
              fill="none"
              stroke={s.color}
              strokeWidth={hover === s.id ? 17 : 14}
              strokeDasharray={`${Math.max(0, len - 0.6)} ${C}`}
              strokeDashoffset={-offsets[i]}
              onMouseEnter={() => setHover(s.id)}
              onMouseLeave={() => setHover(null)}
              style={{ opacity: hover && hover !== s.id ? 0.35 : 1, transition: 'opacity .15s, stroke-width .15s', animation: `gl-fade .5s ${i * 0.08}s ease both` }}
            />
          )
        })}
        <text x={50} y={50} transform="rotate(90 50 50)" textAnchor="middle" dominantBaseline="middle" className="fill-ink font-display" style={{ fontSize: 12, fontWeight: 800 }}>
          {cur ? `${((cur.v / total) * 100).toFixed(0)}%` : fmtCompactUsd(total)}
        </text>
      </svg>
      <ul className="m-0 flex min-w-0 flex-1 list-none flex-col gap-[5px] p-0">
        {slices.map((s) => (
          <li key={s.id} onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)} className={`flex items-center gap-2 rounded-[4px] px-1 text-[13px] ${hover === s.id ? 'bg-surface-hover' : ''}`}>
            <i className="size-[9px] flex-none rounded-[2px]" style={{ background: s.color }} />
            <span className="truncate text-ink-2">
              {s.label}
              {s.chain && <span className="ml-1 font-mono text-[10px] text-faint">{s.chain === 'bsc' ? 'BNB' : 'RH'}</span>}
            </span>
            <span className="ml-auto font-mono text-[12px] text-muted">{fmtCompactUsd(s.v)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* The two chains side by side: stocks, typical gap, liquidity and volume as paired bars. */
export function ChainCompare({ rows, chains }: { rows: TrackerRow[]; chains: { key: string; name: string }[] }) {
  const stats = chains.map((c) => {
    const rs = rows.filter((r) => r.chain === c.key)
    return {
      ...c,
      stocks: rs.length,
      gap: median(trusted(rs).map((r) => Math.abs(r.gapPct ?? 0))),
      liquidity: rs.reduce((a, r) => a + (r.pool?.totalLiquidityUsd ?? 0), 0),
      volume: rs.reduce((a, r) => a + (r.pool?.totalVolume24hUsd ?? 0), 0),
    }
  })
  const metrics: { k: string; label: string; get: (s: (typeof stats)[number]) => number | null; fmt: (v: number) => string; lowerBetter?: boolean }[] = [
    { k: 'stocks', label: 'Stocks tracked', get: (s) => s.stocks, fmt: (v) => String(v) },
    { k: 'gap', label: 'Typical gap', get: (s) => s.gap, fmt: (v) => `${v.toFixed(2)}%`, lowerBetter: true },
    { k: 'liquidity', label: 'Pool liquidity', get: (s) => s.liquidity, fmt: fmtCompactUsd },
    { k: 'volume', label: 'Volume 24h', get: (s) => s.volume, fmt: fmtCompactUsd },
  ]
  const colors = ['#e8c060', '#5aa9e6']
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-4 font-mono text-[11px] text-faint">
        {stats.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-2">
            <i className="size-[9px] rounded-[2px]" style={{ background: colors[i] }} />
            {s.name}
          </span>
        ))}
      </div>
      {metrics.map((m, mi) => {
        const vals = stats.map((s) => m.get(s))
        const max = Math.max(1e-9, ...vals.map((v) => v ?? 0))
        return (
          <div key={m.k} className="flex flex-col gap-[5px]">
            <span className="text-[12px] text-muted">
              {m.label}
              {m.lowerBetter && <span className="ml-1 font-mono text-[10px] text-faint">lower is tighter</span>}
            </span>
            {stats.map((s, i) => {
              const v = vals[i]
              return (
                <div key={s.key} className="flex items-center gap-2">
                  <div className="h-[10px] flex-1 overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full" style={{ width: `${v === null ? 0 : Math.max(2, (v / max) * 100)}%`, background: colors[i], transformOrigin: 'left', animation: `gl-grow-x .7s ${mi * 0.1 + i * 0.06}s cubic-bezier(.2,.8,.2,1) both` }} />
                  </div>
                  <span className="w-[64px] text-right font-mono text-[12px] text-ink-2">{v === null ? '—' : m.fmt(v)}</span>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
