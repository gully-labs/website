import { useState } from 'react'
import { insetPx, type Mark } from './registry'

/* The square every logo sits in: a fixed width and height (no layout shift), the mark centred with
   whole-pixel padding, lazy loading and async decoding. Only if the file fails to load (or none is
   known) does a neutral disc with the symbol stand in. Round for chains and tokens, a rounded tile
   for venues. */
export function Logo({ mark, label, size, shape, alt, title, className = '' }: { mark: Mark | null; label: string; size: number; shape: 'round' | 'tile'; alt: string; title?: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  const radius = shape === 'round' ? '50%' : `${Math.max(3, Math.round(size * 0.22))}px`
  if (!mark || failed) {
    const text = label.slice(0, size >= 24 ? 4 : 2)
    return (
      <span
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
        title={title}
        className={`inline-flex flex-none select-none items-center justify-center overflow-hidden border border-line-strong bg-surface-deep font-mono font-medium leading-none text-muted ${className}`}
        style={{ width: size, height: size, borderRadius: radius, fontSize: Math.max(7, Math.round(size * (text.length > 2 ? 0.3 : 0.42))) }}
      >
        {text}
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
