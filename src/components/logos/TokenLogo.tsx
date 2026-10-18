import { useState } from 'react'
import { Logo } from './Logo'
import { tokenMark, type LogoSize } from './registry'

/** The PNG sizes /api/logo serves (server/token-logos.mjs). */
const SERVED = [64, 128, 256] as const
const served = (px: number) => SERVED.find((s) => s >= px) ?? 256

/** The logo service's URL for one token at one served size. */
const logoUrl = (chain: string, address: string, px: number) => `/api/logo/${encodeURIComponent(chain.trim().toLowerCase())}/${encodeURIComponent(address.trim())}.png?s=${served(px)}`

/**
 * A token's logo, round, at a fixed size (no layout shift).
 *
 * With `chain` and `address` it comes from the logo service (/api/logo, which resolves DeepCore, DexScreener,
 * Jupiter, xStocks, CoinGecko and Trust Wallet server-side and answers the kit's neutral token glyph when
 * nothing is found): a lazy <img> with a 1x/2x srcset, a round mask and a hairline ring in the kit's slate,
 * alt "{symbol} logo". If the request itself fails, the same neutral glyph is drawn here (never a letter tile).
 *
 * Without an address it is the bundled mark for a well-known coin by symbol (ETH, BNB, USDC, USDT, SOL, POL,
 * AVAX), as before. Decorative when the symbol is written next to it.
 */
export function TokenLogo({ symbol, chain, address, size = 20, decorative = false, className = '' }: { symbol: string; chain?: string | null; address?: string | null; size?: LogoSize; decorative?: boolean; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (!chain || !address) {
    const m = tokenMark(symbol)
    return <Logo mark={m} glyph="token" size={size} shape="round" alt={decorative ? '' : symbol} title={m?.name} className={className} />
  }
  const alt = decorative ? '' : `${symbol} logo`
  if (failed) {
    return (
      <span data-logo="token" className={`inline-flex flex-none ${className}`} style={{ width: size, height: size }}>
        <Logo mark={null} glyph="token" size={size} shape="round" alt={alt} title={symbol} />
      </span>
    )
  }
  const x1 = logoUrl(chain, address, size)
  return (
    <span data-logo="token" title={symbol} className={`relative inline-flex flex-none overflow-hidden rounded-full bg-surface-deep ${className}`} style={{ width: size, height: size }}>
      <img
        src={x1}
        srcSet={`${x1} 1x, ${logoUrl(chain, address, size * 2)} 2x`}
        alt={alt}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
        className="block max-w-none rounded-full object-cover"
        style={{ width: size, height: size }}
      />
      {/* The hairline ring sits above the image so a logo with a light or empty edge keeps its outline. */}
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full" style={{ boxShadow: 'inset 0 0 0 1px var(--color-line-strong)' }} />
    </span>
  )
}
