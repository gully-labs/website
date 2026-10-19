import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ChainLogo, StockLogo } from './StockLogo'
import { xPost } from '../../lib/share'
import { ageText, CHAIN_NAME, CHAIN_SHORT, DOWN, fmtCompactUsd, fmtGap, fmtPrice, gapColor, gapPost, STATUS_LABEL, stockPath, UP, type TrackerRow, type TrackerStatus } from '../../lib/tracker'
import { SocialIcon } from '../SocialIcon'
import { C, alpha } from '../charts/chartPresets'
import { NewTabMark } from '../LayoutLinks'
import { newTab } from '../LayoutNav'

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
    r.status === 'premium' ? { c: UP, bg: alpha(UP, 0.09) } : r.status === 'discount' ? { c: DOWN, bg: alpha(DOWN, 0.09) } : r.status === 'in-line' ? { c: C.muted, bg: alpha(C.muted, 0.08) } : r.status === 'drifting' ? { c: C.gold, bg: alpha(C.gold, 0.1) } : { c: C.faint, bg: 'transparent' }
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
                className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 font-mono text-[12px] max-[859px]:min-h-11 transition-colors ${filter === f.id ? 'border-gold bg-gold text-bg' : 'border-line-strong text-ink-2 hover:border-gold'}`}
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
            aria-label="Search stocks by ticker or name"
            className="h-11 w-full rounded-input border border-line-strong bg-bg pr-3 pl-9 text-[14px] text-ink outline-none focus:border-gold"
          />
        </label>
      </div>

      {/* Desktop table */}
      <div className="overflow-x-auto rounded-card border border-line bg-surface max-[859px]:hidden">
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
              <th className="px-3 py-2 text-right font-mono text-[11px] font-medium tracking-[1px] whitespace-nowrap text-faint" title="When Chainlink last updated the fair price. Feeds hold their last value while the market is closed.">FEED AGE</th>
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
                  // Opacity only, and quick: a full-page capture or print never shows half the table blank.
                  style={{ animation: `gl-fade .3s ${Math.min(i * 0.015, 0.3)}s ease-out both` }}
                >
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => onSelect(id)} className="flex items-center gap-3 bg-transparent p-0 text-left" aria-pressed={on}>
                      <StockLogo row={r} size={30} active={on} />
                      <span className="flex flex-col">
                        <span className="flex items-baseline gap-2">
                          <b className={`font-display text-[15px] font-bold ${on ? 'text-gold' : 'text-ink'}`}>{r.ticker}</b>
                          <span className="text-ink-2">{r.name}</span>
                        </span>
                        {multi && (
                          <span className="flex items-center gap-1 font-mono text-[11px] text-faint">
                            <ChainLogo chain={r.chain} size={10} />
                            {CHAIN_NAME[r.chain] ?? r.chain}
                          </span>
                        )}
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{fmtPrice(r.onchain)}</td>
                  <td className="px-3 py-2 text-right font-mono text-muted">{fmtPrice(r.fair)}</td>
                  <td className="px-3 py-2 text-right font-mono font-medium" style={{ color: gapColor(r) }}>
                    {fmtGap(r.gapPct)}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge r={r} />
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{fmtCompactUsd(r.pool?.liquidityUsd)}</td>
                  <td className="px-3 py-2 text-right font-mono text-muted">{fmtCompactUsd(r.pool?.totalVolume24hUsd)}</td>
                  <td className="min-w-[72px] px-3 py-2 text-right font-mono text-[12px] whitespace-nowrap text-faint">{ageText(r.feedUpdatedAt, now)}</td>
                  <td className="px-3 py-2">
                    <span className="flex items-center justify-end gap-1 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <Link to={stockPath(r)} aria-label={`${r.ticker} page`} className="inline-flex h-8 items-center rounded-btn border border-gold-line px-3 text-[12px] text-gold transition-colors hover:border-gold hover:text-gold">
                        Page
                      </Link>
                      {r.pool?.url && (
                        <a href={r.pool.url} {...newTab} aria-label={`${r.ticker} pool on DexScreener (opens in a new tab)`} className="inline-flex h-8 items-center gap-1 rounded-btn border border-line-strong px-3 text-[12px] whitespace-nowrap text-ink transition-colors hover:border-gold hover:text-ink">
                          Pool <NewTabMark size={12} />
                        </a>
                      )}
                      <a
                        href={xPost(gapPost(r), SHARE_URL)}
                        {...newTab}
                        aria-label={`Post ${r.ticker}'s gap on X (opens in a new tab)`}
                        className="inline-flex h-8 items-center justify-center gap-0.5 rounded-btn border border-line px-2 text-muted transition-colors hover:border-gold hover:text-gold"
                      >
                        <SocialIcon name="X" size={13} />
                        <NewTabMark size={11} className="flex-none" />
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
                    <StockLogo row={r} size={32} active={selected === id} />
                    <span className="font-display text-[20px] font-bold">{r.ticker}</span>
                    <span className="text-[13px] text-muted">
                      {r.name}
                      {multi && ` · ${CHAIN_SHORT[r.chain] ?? r.chain}`}
                    </span>
                  </span>
                  <span className="font-mono text-[16px] font-medium" style={{ color: gapColor(r) }}>
                    {fmtGap(r.gapPct)}
                  </span>
                </span>
                <span className="grid grid-cols-3 gap-2 font-mono text-[12px]">
                  <span className="flex flex-col">
                    <span className="text-[11px] text-faint">ONCHAIN</span>
                    {fmtPrice(r.onchain)}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-[11px] text-faint">FAIR</span>
                    {fmtPrice(r.fair)}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-[11px] text-faint">LIQUIDITY</span>
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
