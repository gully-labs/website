import { useId, useState } from 'react'
import { Link } from 'react-router'
import { Search } from 'lucide-react'
import { CHAIN_SHORT, fmtGap, stockPath, useTracker } from '../../lib/tracker'
import { StockLogo } from './StockLogo'

/** A search over every tracked stock token (live /api/tracker), each match a link to its page.
    Used where a visitor arrived at a stock or a page that does not exist. */
export function StockSearch({ initial = '' }: { initial?: string }) {
  const st = useTracker()
  const [q, setQ] = useState(initial)
  const id = useId()
  const needle = q.trim().toLowerCase()
  const rows = st.k === 'ok' ? st.data.rows : []
  const matches = needle ? rows.filter((r) => r.ticker.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle)) : []
  // Nothing typed, or nothing matches: show the widest gaps instead, so the list is never empty.
  const hits = (matches.length ? matches : [...rows].sort((a, b) => Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0))).slice(0, 8)
  return (
    <div className="flex w-full max-w-[640px] flex-col gap-3">
      <label htmlFor={id} className="font-mono text-[11px] tracking-[1px] text-faint">
        FIND A STOCK TOKEN
      </label>
      <span className="relative flex items-center">
        <Search aria-hidden size={16} className="pointer-events-none absolute left-3 text-faint" />
        <input
          id={id}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="NVDA, Tesla…"
          autoComplete="off"
          className="h-12 w-full rounded-input border border-line-strong bg-bg pr-3 pl-10 text-[15px] text-ink outline-none focus:border-gold"
        />
      </span>
      {st.k === 'loading' && <div aria-hidden className="h-[96px] animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-card bg-surface" />}
      {st.k === 'error' && <p className="m-0 font-mono text-[12px] text-faint">The tracker could not be read just now; try the tracker page.</p>}
      {st.k === 'ok' && (
        <>
          {needle && !matches.length && <p className="m-0 font-mono text-[12px] text-faint">Nothing matches “{q.trim()}”. The widest gaps right now:</p>}
          <ul aria-live="polite" className="m-0 flex list-none flex-wrap gap-2 p-0">
            {hits.map((r) => (
              <li key={`${r.chain}:${r.ticker}`}>
                <Link to={stockPath(r)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface py-[5px] pr-3 pl-[5px] text-[13px] text-ink-2 transition-colors hover:border-gold hover:text-ink">
                  <StockLogo row={r} size={26} chainBadge={false} />
                  <b className="font-display text-[15px]">{r.ticker}</b>
                  <span className="font-mono text-[11px] text-faint">{CHAIN_SHORT[r.chain] ?? r.chain}</span>
                  <span className="font-mono text-[12px] text-muted">{fmtGap(r.gapPct)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
