import { useState } from 'react'
import { logoByTicker, logoByToken } from '../../content/stockLogos'
import type { TrackerRow } from '../../lib/tracker'

/* Chain marks: Robinhood's own site icon, and BNB's logo from its token listing (public/chains/SOURCES.json). */
const CHAIN_LOGO: Record<string, { src: string; name: string }> = {
  robinhood: { src: '/chains/robinhood.png', name: 'Robinhood Chain' },
  bsc: { src: '/chains/bnb.png', name: 'BNB Chain' },
}

/** A chain's logo, round, at any size. */
export function ChainLogo({ chain, size = 14, className = '' }: { chain: string; size?: number; className?: string }) {
  const c = CHAIN_LOGO[chain]
  if (!c) return null
  return <img src={c.src} alt="" title={c.name} width={size} height={size} decoding="async" className={`flex-none rounded-full ${className}`} style={{ width: size, height: size }} />
}

/** The stock's logo: the token's own where it carries the company mark, else the company's site icon,
    with the chain's mark in the corner. Falls back to the ticker when no logo exists or it fails to load. */
export function StockLogo({ row, size = 28, active = false, chainBadge = true }: { row: Pick<TrackerRow, 'chain' | 'ticker' | 'token'>; size?: number; active?: boolean; chainBadge?: boolean }) {
  const src = logoByToken[`${row.chain}/${row.token.toLowerCase()}`] ?? logoByTicker[row.ticker]
  const [failed, setFailed] = useState(false)
  const badge = Math.round(size * 0.42)
  return (
    <span className="relative inline-flex flex-none" style={{ width: size, height: size }} aria-hidden>
      {!src || failed ? (
        <span
          className={`flex size-full items-center justify-center rounded-full border bg-surface font-display font-bold ${active ? 'border-gold text-gold' : 'border-line-strong text-ink'}`}
          style={{ fontSize: Math.max(9, size * 0.32) }}
        >
          {row.ticker.slice(0, 4)}
        </span>
      ) : (
        <span className={`flex size-full items-center justify-center overflow-hidden rounded-full bg-white ring-1 ${active ? 'ring-gold' : 'ring-line-strong'}`}>
          <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setFailed(true)} className="size-[82%] object-contain" />
        </span>
      )}
      {chainBadge && CHAIN_LOGO[row.chain] && (
        <span className="absolute -right-[3px] -bottom-[3px] rounded-full bg-bg p-[1.5px]">
          <ChainLogo chain={row.chain} size={badge} />
        </span>
      )}
    </span>
  )
}
