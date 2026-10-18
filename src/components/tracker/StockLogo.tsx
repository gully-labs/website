import { useState } from 'react'
import { Building2 } from 'lucide-react'
import { logoFit } from '../../content/logoFit'
import { logoByTicker, logoByToken } from '../../content/stockLogos'
import type { TrackerRow } from '../../lib/tracker'
import { Logo } from '../logos/Logo'
import { chainMark } from '../logos/registry'

/** A chain's official mark, round, at the small sizes the tracker uses (registry: components/logos). */
export function ChainLogo({ chain, size = 14, named = false, className = '' }: { chain: string; size?: number; named?: boolean; className?: string }) {
  const m = chainMark(chain)
  if (!m) return null
  return <Logo mark={m} glyph="chain" size={size} shape="round" alt={named ? m.name : ''} title={m.name} className={className} />
}

/** The stock's logo: the token's own where it carries the company mark, else the company's site icon,
    with the chain's mark in the corner. Falls back to a neutral company glyph (never ticker letters) when no logo exists or it fails to load. */
export function StockLogo({ row, size = 28, active = false, chainBadge = true }: { row: Pick<TrackerRow, 'chain' | 'ticker' | 'token'>; size?: number; active?: boolean; chainBadge?: boolean }) {
  const src = logoByToken[`${row.chain}/${row.token.toLowerCase()}`] ?? logoByTicker[row.ticker]
  const [failed, setFailed] = useState(false)
  const badge = Math.round(size * 0.42)
  // A filled tile or disc fills the circle; a transparent mark takes the share of the disc measured so the
  // circle never crops it (content/logoFit.ts), with whole, equal margins so it stays centred and crisp.
  const fit = src ? logoFit[src] : undefined
  const inner = fit?.full ? size : size - 2 * Math.round((size * (1 - (fit?.scale ?? 0.82))) / 2)
  return (
    <span className="relative inline-flex flex-none" style={{ width: size, height: size }} aria-hidden>
      {!src || failed ? (
        <span className={`flex size-full items-center justify-center rounded-full border bg-surface ${active ? 'border-gold text-gold' : 'border-line-strong text-muted'}`}>
          <Building2 aria-hidden size={Math.max(8, Math.round(size * 0.52))} strokeWidth={size >= 24 ? 1.75 : 2} />
        </span>
      ) : (
        <span className={`flex size-full items-center justify-center overflow-hidden rounded-full bg-[#fff] ring-1 ${active ? 'ring-gold' : 'ring-line-strong'}`}>
          <img src={src} alt="" width={inner} height={inner} loading="lazy" decoding="async" onError={() => setFailed(true)} className={`block max-w-none ${fit?.full ? 'object-cover' : 'object-contain'}`} style={{ width: inner, height: inner }} />
        </span>
      )}
      {chainBadge && chainMark(row.chain) && (
        <span className="absolute -right-[3px] -bottom-[3px] inline-flex rounded-full bg-bg p-[2px]">
          <ChainLogo chain={row.chain} size={badge} />
        </span>
      )}
    </span>
  )
}
