import { useId } from 'react'
import { KIT, type KitTheme } from './kit.generated'

/* The Gully Labs lockups from the brand kit: the mascot bust beside (horizontal) or above (stacked)
   the wordmark, laid out exactly as the kit's SVGs do (the geometry is read from them by
   scripts/brand-from-kit.mjs). The bust is the kit's photoreal render, so it stays a PNG: the 2x file is
   used whenever the bust would render wider than its 1x master in device pixels, and nothing is ever
   upscaled. The kit's minimum width for a lockup is 180 px. */
const dpr = () => (typeof window !== 'undefined' && window.devicePixelRatio) || 1

export function Lockup({ variant = 'horizontal', height = 64, theme = 'dark', className = '', label = 'Gully Labs', decorative = false }: { variant?: 'horizontal' | 'stacked'; height?: number; theme?: KitTheme; className?: string; label?: string; decorative?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  const L = KIT.lockups[variant]
  const w = KIT.wordmark
  const width = Math.round(((height * L.width) / L.height) * 100) / 100
  const bustPx = (height * L.image.width) / L.height
  const bust = bustPx * dpr() > KIT.bust.width ? KIT.bust.src2x : KIT.bust.src
  const lg = w.labsGradient
  const bg = w.barGradient
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${L.width} ${L.height}`}
      width={width}
      height={height}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      focusable="false"
      data-brand="kit"
      className={`block shrink-0 ${className}`}
      style={{ width, height }}
    >
      {!decorative && <title>{label}</title>}
      <defs>
        <linearGradient id={`${id}-labs`} gradientUnits="userSpaceOnUse" x1={lg.x1} y1={lg.y1} x2={lg.x2} y2={lg.y2}>
          {lg[theme].map(([o, c]) => (
            <stop key={o} offset={o} stopColor={c} />
          ))}
        </linearGradient>
        <linearGradient id={`${id}-bar`} gradientUnits="userSpaceOnUse" x1={bg.x1} y1={bg.y1} x2={bg.x2} y2={bg.y2}>
          {bg[theme].map(([o, c]) => (
            <stop key={o} offset={o} stopColor={c} />
          ))}
        </linearGradient>
      </defs>
      <image href={bust} x={L.image.x} y={L.image.y} width={L.image.width} height={L.image.height} />
      <g transform={`translate(${L.wordmark.x} ${L.wordmark.y}) scale(${L.wordmark.scale})`}>
        <path fill={w.fill[theme]} d={w.gully} />
        <path fill={`url(#${id}-labs)`} d={w.labs} />
        <rect x={w.bar.x} y={w.bar.y} width={w.bar.width} height={w.bar.height} fill={`url(#${id}-bar)`} />
      </g>
    </svg>
  )
}
