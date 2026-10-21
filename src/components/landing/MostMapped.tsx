import { Link } from 'react-router'
import { ScanSearch } from 'lucide-react'
import { useLiveSeries } from '../charts/useLiveSeries'
import { ChainLogo } from '../logos/ChainLogo'
import { TokenLogo } from '../logos/TokenLogo'
import { servable } from '../tracker/servable'
import type { TopScanned } from '../../lib/holders'

/* "Most mapped today" on the home page: the five Holder Maps people opened most, from the same endpoint the
   /holders landing lists (GET /api/holders/top), polled every 60 s. Each row has the token's logo, its chain,
   the scans and the map's health badge image (GET /api/holders/:chain/:token/badge.svg, cached data only).
   Nothing yet today: five ghost rows say so, with the link to the search. */

const ROWS = 5

export function MostMapped() {
  const { data, error } = useLiveSeries<TopScanned>(
    (signal) =>
      fetch('/api/holders/top?limit=5', { headers: { accept: 'application/json' }, signal }).then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json() as Promise<TopScanned>
      }),
    60_000,
  )
  const items = data?.items.slice(0, ROWS) ?? []
  const max = Math.max(1, ...items.map((x) => x.scans))
  const empty = data !== undefined && !items.length
  return (
    <section aria-labelledby="most-mapped" data-most-mapped className="border-t border-line px-page py-8 max-[599px]:py-6">
      <div className="card card-pad flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="most-mapped" className="heading-4 m-0 flex items-center gap-2">
            <ScanSearch aria-hidden size={18} className="text-gold" /> Most mapped today
          </h2>
          <span className="flex items-center gap-2 font-mono text-[11px] tracking-[1px] text-dim">
            <span className="relative inline-flex size-2.5" aria-hidden>
              <span className="absolute inset-0 animate-[gl-live-pulse_2s_ease-out_infinite] rounded-full bg-gold motion-reduce:animate-none" />
              <span className="relative size-2.5 rounded-full bg-gold" />
            </span>
            LIVE
            <Link to="/holders" className="ml-2 inline-flex min-h-11 items-center text-gold">
              Holder Map →
            </Link>
          </span>
        </div>
        {data === undefined && !error && <div role="status" aria-label="Reading the most mapped tokens" className="h-[220px] animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-[10px] bg-surface-deep" />}
        {(empty || (data === undefined && !!error)) && (
          <div data-most-mapped-ghost className="flex flex-col gap-1">
            {Array.from({ length: ROWS }, (_, i) => (
              <div key={i} aria-hidden className="flex h-11 items-center gap-3 rounded-[8px] border border-line px-3">
                <span className="size-6 flex-none animate-[gl-skeleton_2s_ease-in-out_infinite] rounded-full bg-surface-deep" style={{ animationDelay: `${i * 120}ms` }} />
                <span className="h-2.5 w-20 animate-[gl-skeleton_2s_ease-in-out_infinite] rounded bg-surface-deep" style={{ animationDelay: `${i * 120}ms` }} />
              </div>
            ))}
            <p className="m-0 text-[13px] text-muted">{empty ? 'No maps opened yet today. Paste a token above and be the first.' : 'The list could not be read just now; it retries every minute.'}</p>
          </div>
        )}
        {items.length > 0 && (
          <ol className="m-0 flex list-none flex-col gap-1 p-0" data-most-mapped-list>
            {items.map((x, i) => {
              const own = x.kind !== 'stock' && servable(x.chain, x.token)
              return (
                <li key={`${x.chain}:${x.token}`}>
                  <Link to={x.path} className="relative flex min-h-11 items-center gap-3 overflow-hidden rounded-[8px] border border-line px-3 text-[14px] hover:border-gold">
                    <span aria-hidden className="absolute inset-y-0 left-0 origin-left animate-[gl-grow-x_.8s_ease_both] bg-gold/10 motion-reduce:animate-none" style={{ width: `${(x.scans / max) * 100}%`, animationDelay: `${i * 40}ms` }} />
                    <span className="relative w-4 font-mono text-[12px] text-faint">{i + 1}</span>
                    <TokenLogo symbol={x.symbol ?? 'token'} chain={own ? x.chain : null} address={own ? x.token : null} size={24} decorative className="relative" />
                    <span className="relative min-w-0 truncate font-semibold text-ink">{x.symbol ?? `${x.token.slice(0, 6)}…`}</span>
                    <ChainLogo chain={x.chain} size={14} decorative className="relative max-[419px]:hidden" />
                    <span className="relative ml-auto flex-none font-mono text-[12px] text-muted">
                      {x.scans.toLocaleString('en-US')}
                      <span className="max-[419px]:hidden"> scans</span>
                    </span>
                    <img src={`/api/holders/${encodeURIComponent(x.chain)}/${encodeURIComponent(x.token)}/badge.svg?size=S`} alt={`Holder Map badge of ${x.symbol ?? 'this token'}`} height={20} loading="lazy" className="relative h-5 w-auto max-w-[96px] flex-none max-[419px]:hidden" />
                  </Link>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </section>
  )
}
