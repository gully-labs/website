import { lazy, Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Search } from 'lucide-react'
import { useHolderSearch } from '../../lib/holderResolve'
import type { MapPreview } from '../holders/MiniMap'

/* The home hero's Holder Map search: paste any token address or a ticker, Enter opens its map. It shares the
   /holders search (src/lib/holderResolve.ts: GET /api/holders/resolve finds the chain; several matches offer a
   pick). Beside it a tiny live map: the newest checked launch's bubbles from GET /api/holders/launches, drawn
   by the same MiniMap as the /holders feed; until one is checked, three breathing placeholder bubbles. */

const MiniMap = lazy(() => import('../holders/MiniMap'))

function useLivePreview() {
  const [p, setP] = useState<{ preview: MapPreview; symbol: string | null } | null>(null)
  useEffect(() => {
    const ac = new AbortController()
    fetch('/api/holders/launches', { headers: { accept: 'application/json' }, signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { launches?: { symbol: string | null; preview?: MapPreview | null }[] } | null) => {
        const l = b?.launches?.find((x) => x.preview?.nodes?.length)
        if (l?.preview) setP({ preview: l.preview, symbol: l.symbol })
      })
      .catch(() => {})
    return () => ac.abort()
  }, [])
  return p
}

function GhostBubbles() {
  return (
    <span aria-hidden className="relative block h-[56px] w-[76px]">
      <span className="absolute top-1 left-2 size-9 animate-[gl-skeleton_2.4s_ease-in-out_infinite] rounded-full border border-gold-line bg-gold/10 motion-reduce:animate-none" />
      <span className="absolute right-2 bottom-1 size-6 animate-[gl-skeleton_2.4s_.4s_ease-in-out_infinite] rounded-full border border-line-strong bg-surface-deep motion-reduce:animate-none" />
      <span className="absolute right-3 top-1 size-3.5 animate-[gl-skeleton_2.4s_.8s_ease-in-out_infinite] rounded-full border border-line-strong bg-surface-deep motion-reduce:animate-none" />
    </span>
  )
}

export function HolderSearchHero() {
  const { q, s, go, change } = useHolderSearch()
  const live = useLivePreview()
  return (
    <div className="flex max-w-[480px] flex-col gap-2" data-hero-holder-search>
      <div className="flex items-center gap-3">
        <form role="search" onSubmit={go} className="flex min-w-0 flex-1 items-center gap-1 rounded-card border border-line-strong bg-surface pl-3 focus-within:border-gold">
          <Search size={16} aria-hidden className="flex-none text-faint" />
          <label htmlFor="hero-hq" className="sr-only">
            Token address or ticker
          </label>
          <input
            id="hero-hq"
            value={q}
            onChange={(e) => change(e.target.value)}
            placeholder="0x… / mint / $ticker"
            className="min-h-11 min-w-0 flex-1 bg-transparent font-mono text-[16px] text-ink outline-none placeholder:text-faint"
            spellCheck={false}
            autoComplete="off"
          />
          <button type="submit" disabled={s.k === 'busy'} className="m-1 min-h-9 flex-none rounded-btn bg-gold px-3 text-[14px] font-semibold text-bg hover:bg-gold-hover disabled:opacity-60">
            {s.k === 'busy' ? '…' : 'Map it'}
          </button>
        </form>
        <div className="flex-none max-[419px]:hidden" aria-hidden={live ? undefined : true}>
          {live ? (
            <Suspense fallback={<GhostBubbles />}>
              <MiniMap preview={live.preview} label={`Holder Map of ${live.symbol ?? 'the newest launch'} in miniature`} />
            </Suspense>
          ) : (
            <GhostBubbles />
          )}
        </div>
      </div>
      <p className="m-0 text-[13px] leading-[1.4] text-muted">
        Paste any token address or ticker → see who really holds it. <span className="max-[419px]:hidden">Five chains, no sign-up. </span>
        <Link to="/holders" className="text-gold">
          Holder Map →
        </Link>
      </p>
      <div aria-live="polite">
        {s.k === 'none' && <p className="m-0 text-[13px] leading-[1.5] text-muted">{s.address ? 'No token at that address on the chains we cover.' : 'Not an address or a ticker we follow. Try 0x…, a Solana mint or NVDA.'}</p>}
        {s.k === 'limit' && <p className="m-0 text-[13px] text-muted">A lot of new addresses just now. Try again in a minute.</p>}
        {s.k === 'error' && <p className="m-0 text-[13px] text-error">The search did not answer. Try again.</p>}
        {s.k === 'many' && (
          <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Pick a chain" data-resolve-matches>
            {s.matches.map((m) => (
              <li key={`${m.chain}:${m.token}`}>
                <Link to={m.path} className="flex min-h-11 items-center gap-3 rounded-[8px] border border-line px-3 text-[14px] hover:border-gold">
                  <span className="font-semibold text-ink">{m.symbol ?? `${m.token.slice(0, 6)}…${m.token.slice(-4)}`}</span>
                  <span className="font-mono text-[12px] text-faint">{m.chainName}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
