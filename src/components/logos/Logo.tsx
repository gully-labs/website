import { useState } from 'react'
import { CircleDollarSign, Network, Store, type LucideIcon } from 'lucide-react'
import { insetPx, type Mark } from './registry'

/** What a missing mark stands for: the neutral glyph shown in its place (never a letter or initials tile). */
export type LogoGlyph = 'chain' | 'token' | 'venue'
const GLYPHS: Record<LogoGlyph, LucideIcon> = { chain: Network, token: CircleDollarSign, venue: Store }

/* The square every logo sits in: a fixed width and height (no layout shift), the mark centred with
   whole-pixel padding, lazy loading and async decoding. Only if the file fails to load (or none is
   known) does a neutral disc with a kit-coloured glyph stand in (the name stays in the label). Round for chains and tokens, a rounded tile
   for venues. */
export function Logo({ mark, glyph, size, shape, alt, title, className = '' }: { mark: Mark | null; glyph: LogoGlyph; size: number; shape: 'round' | 'tile'; alt: string; title?: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  // Tiles take the radius scale (src/index.css): 8 from 32 px, 6 from 20 px, 4 below.
  const radius = shape === 'round' ? '50%' : `${size >= 32 ? 8 : size >= 20 ? 6 : 4}px`
  if (!mark || failed) {
    const Glyph = GLYPHS[glyph]
    return (
      <span
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
        title={title}
        className={`inline-flex flex-none select-none items-center justify-center overflow-hidden border border-line-strong bg-surface-deep text-muted ${className}`}
        style={{ width: size, height: size, borderRadius: radius }}
      >
        {size >= 12 && <Glyph aria-hidden size={Math.max(8, Math.round(size * 0.56))} strokeWidth={size >= 24 ? 1.75 : 2} />}
      </span>
    )
  }
  const pad = insetPx(size, mark.inset)
  const inner = size - pad * 2
  return (
    <span title={title} className={`inline-flex flex-none items-center justify-center overflow-hidden ${className}`} style={{ width: size, height: size, borderRadius: radius, background: mark.disc ?? undefined }}>
      <img src={mark.src} alt={alt} width={inner} height={inner} loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} className="block max-w-none object-contain" style={{ width: inner, height: inner }} />
    </span>
  )
}
