import { useMemo, useState } from 'react'
import { xPost } from '../../lib/share'
import { ageText, CHAIN_SHORT, DOWN, fmtCompactUsd, fmtGap, fmtPrice, gapPost, STATUS_LABEL, UP, type TrackerRow, type TrackerStatus } from '../../lib/tracker'
import { SocialIcon } from '../SocialIcon'

type SortKey = 'ticker' | 'gap' | 'absgap' | 'onchain' | 'liquidity' | 'volume'
type Filter = 'all' | 'flagged' | 'in-line' | 'thin'

const FILTERS: { id: Filter; label: string; match: (s: TrackerStatus) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'flagged', label: 'Off by 2%+', match: (s) => s === 'premium' || s === 'discount' },
  { id: 'in-line', label: 'In line', match: (s) => s === 'in-line' || s === 'drifting' },
  { id: 'thin', label: 'Thin or no pool', match: (s) => s === 'thin' || s === 'no-pool' || s === 'pool-unreadable' || s === 'feed-unreadable' },
]

const SHARE_URL = 'https://gullylabs.xyz/tracker'

export function StatusBadge({ r }: { r: TrackerRow }) {
  const tone =
    r.status === 'premium' ? { c: UP, bg: 'rgba(31,158,137,.12)' } : r.status === 'discount' ? { c: DOWN, bg: 'rgba(228,87,46,.12)' } : r.status === 'in-line' ? { c: '#a6b0bd', bg: 'rgba(166,176,189,.08)' } : r.status === 'drifting' ? { c: '#e8c060', bg: 'rgba(232,192,96,.1)' } : { c: '#6c7888', bg: 'transparent' }
  return (
    <span className="inline-flex items-center gap-[6px] rounded-full border px-[9px] py-[2px] font-mono text-[11px] whitespace-nowrap" style={{ color: tone.c, background: tone.bg, borderColor: `${tone.c}40` }}>
      {(r.status === 'premium' || r.status === 'discount') && <i className="size-[6px] rounded-full" style={{ background: tone.c, animation: 'gl-blink 1.6s ease-in-out infinite' }} />}
      {STATUS_LABEL[r.status]}
    </span>
  )
}

/** Sortable, searchable, filterable table; on phones each row becomes a card. */
export function TrackerTable({ rows, selected, onSelect, now }: { rows: TrackerRow[]; selected: string | null; onSelect: (id: string) => void; now: number }) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'absgap', desc: true })
  const multi = new Set(rows.map((r) => r.chain)).size > 1

  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter)!
    const needle = q.trim().toLowerCase()
    const val = (r: TrackerRow): number | string => {
      switch (sort.key) {
        case 'ticker':
          return r.ticker
        case 'gap':
          return r.gapPct ?? -Infinity
        case 'absgap':
          return r.gapPct === null ? -1 : r.status === 'thin' ? Math.abs(r.gapPct) / 1000 : Math.abs(r.gapPct)
        case 'onchain':
          return r.onchain ?? -1
        case 'liquidity':
          return r.pool?.liquidityUsd ?? -1
        case 'volume':
          return r.pool?.totalVolume24hUsd ?? -1
      }
    }
    return rows
      .filter((r) => f.match(r.status))
      .filter((r) => !needle || r.ticker.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle))
      .sort((a, b) => {
        const x = val(a)
        const y = val(b)
        const c = typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number)
        return sort.desc ? -c : c
      })
  }, [rows, q, filter, sort])

  const head = (key: SortKey, label: string, align = 'text-right') => (
    <th className={`px-3 py-3 font-medium ${align}`} aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button
        type="button"
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'ticker' }))}
        className={`inline-flex items-center gap-1 bg-transparent p-0 font-mono text-[11px] tracking-[1px] transition-colors hover:text-gold ${sort.key === key ? 'text-gold' : 'text-faint'}`}
      >
        {label} {sort.key === key ? (sort.desc ? '↓' : '↑') : ''}
      </button>
    </th>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filter" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const n = rows.filter((r) => f.match(r.status)).length
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 font-mono text-[12px] transition-colors ${filter === f.id ? 'border-gold bg-gold text-bg' : 'border-line-strong text-ink-2 hover:border-gold'}`}
              >
                {f.label}
                <span className={filter === f.id ? 'text-bg/70' : 'text-faint'}>{n}</span>
              </button>
            )
          })}
        </div>
        <label className="relative flex min-h-10 w-full max-w-[280px] items-center">
          <span className="sr-only">Search stocks</span>
          <svg aria-hidden viewBox="0 0 24 24" width={15} height={15} className="pointer-events-none absolute left-3 text-faint" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search NVDA, Tesla…"
            className="h-10 w-full rounded-input border border-line-strong bg-bg pr-3 pl-9 text-[14px] text-ink outline-none focus:border-gold"
          />
        </label>
      </div>

      {/* Desktop table */}
      <div className="overflow-hidden rounded-card border border-line bg-surface max-[859px]:hidden">
        <table className="w-full border-collapse text-[14px]">
          <thead className="bg-surface-deep">
            <tr className="border-b border-line">
              {head('ticker', 'STOCK', 'text-left')}
              {head('onchain', 'ONCHAIN')}
              <th className="px-3 py-2 text-right font-mono text-[11px] font-medium tracking-[1px] text-faint">FAIR</th>
              {head('absgap', 'GAP')}
              <th className="px-3 py-2 text-left font-mono text-[11px] font-medium tracking-[1px] text-faint">STATUS</th>
              {head('liquidity', 'LIQUIDITY')}
              {head('volume', 'VOLUME 24H')}
              <th className="px-3 py-2 text-right font-mono text-[11px] font-medium tracking-[1px] text-faint">FEED</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const id = `${r.chain}:${r.ticker}`
              const on = selected === id
              return (
                <tr
                  key={id}
                  onClick={() => onSelect(id)}
                  className={`cursor-pointer border-b border-line transition-colors last:border-b-0 ${on ? 'bg-surface-hover' : 'hover:bg-surface-hover'}`}
                  style={{ animation: `gl-rise .4s ${Math.min(i * 0.02, 0.6)}s ease both` }}
                >
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => onSelect(id)} className="flex items-center gap-3 bg-transparent p-0 text-left" aria-pressed={on}>
                      <span className={`flex h-7 min-w-12 items-center justify-center rounded-[6px] border px-2 font-display text-[15px] font-bold ${on ? 'border-gold text-gold' : 'border-line-strong text-ink'}`}>{r.ticker}</span>
                      <span className="flex flex-col">
                        <span className="text-ink-2">{r.name}</span>
                        {multi && <span className="font-mono text-[10px] text-faint">{CHAIN_SHORT[r.chain] ?? r.chain}</span>}
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{fmtPrice(r.onchain)}</td>
                  <td className="px-3 py-2 text-right font-mono text-muted">{fmtPrice(r.fair)}</td>
                  <td className="px-3 py-2 text-right font-mono font-medium" style={{ color: r.gapPct === null ? undefined : r.status === 'thin' ? '#6c7888' : r.gapPct >= 0 ? UP : DOWN }}>
                    {fmtGap(r.gapPct)}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge r={r} />
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{fmtCompactUsd(r.pool?.liquidityUsd)}</td>
                  <td className="px-3 py-2 text-right font-mono text-muted">{fmtCompactUsd(r.pool?.totalVolume24hUsd)}</td>
                  <td className="px-3 py-2 text-right font-mono text-[12px] text-faint">{ageText(r.feedUpdatedAt, now)}</td>
                  <td className="px-3 py-2">
                    <span className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      {r.pool?.url && (
                        <a href={r.pool.url} target="_blank" rel="noopener" className="inline-flex h-8 items-center rounded-btn border border-line-strong px-3 text-[12px] text-ink transition-colors hover:border-gold hover:text-ink">
                          Pool ↗
                        </a>
                      )}
                      <a
                        href={xPost(gapPost(r), SHARE_URL)}
                        target="_blank"
                        rel="noopener"
                        aria-label={`Post ${r.ticker}'s gap on X`}
                        className="inline-flex size-8 items-center justify-center rounded-btn border border-line text-muted transition-colors hover:border-gold hover:text-gold"
                      >
                        <SocialIcon name="X" size={13} />
                      </a>
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!shown.length && <p className="m-0 px-5 py-8 text-center font-mono text-[12px] text-faint">Nothing matches.</p>}
      </div>

      {/* Phone cards */}
      <ul className="m-0 hidden list-none flex-col gap-2 p-0 max-[859px]:flex">
        {shown.map((r) => {
          const id = `${r.chain}:${r.ticker}`
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => onSelect(id)}
                aria-pressed={selected === id}
                className={`flex w-full flex-col gap-3 rounded-card border bg-surface p-4 text-left ${selected === id ? 'border-gold' : 'border-line'}`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-3">
                    <span className="font-display text-[20px] font-bold">{r.ticker}</span>
                    <span className="text-[13px] text-muted">
                      {r.name}
                      {multi && ` · ${CHAIN_SHORT[r.chain] ?? r.chain}`}
                    </span>
                  </span>
                  <span className="font-mono text-[16px] font-medium" style={{ color: r.gapPct === null ? undefined : r.status === 'thin' ? '#6c7888' : r.gapPct >= 0 ? UP : DOWN }}>
                    {fmtGap(r.gapPct)}
                  </span>
                </span>
                <span className="grid grid-cols-3 gap-2 font-mono text-[12px]">
                  <span className="flex flex-col">
                    <span className="text-[10px] text-faint">ONCHAIN</span>
                    {fmtPrice(r.onchain)}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-[10px] text-faint">FAIR</span>
                    {fmtPrice(r.fair)}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-[10px] text-faint">LIQUIDITY</span>
                    {fmtCompactUsd(r.pool?.liquidityUsd)}
                  </span>
                </span>
                <StatusBadge r={r} />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
