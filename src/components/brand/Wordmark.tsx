import { useId } from 'react'
import { KIT, type KitTheme } from './kit.generated'

/* The Gully Labs wordmark from the brand kit: "GULLY" in Bone (Lab Night on light backgrounds), "LABS"
   in the kit's gold gradient and the underline bar, as outlined paths (Barlow Condensed 700, no font
   needed), so it is the same shape at every size. `height` is the whole mark in CSS px (glyphs plus bar);
   the width follows the kit's 848:176 ratio. Every logo on the site is one of these components, marked
   data-brand="kit" (the e2e suite checks no other wordmark exists). */
export function Wordmark({ height = 28, theme = 'dark', className = '', label = 'Gully Labs', decorative = false }: { height?: number; theme?: KitTheme; className?: string; label?: string; decorative?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  const w = KIT.wordmark
  const width = Math.round(((height * w.width) / w.height) * 100) / 100
  const lg = w.labsGradient
  const bg = w.barGradient
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${w.width} ${w.height}`}
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
      <path fill={w.fill[theme]} d={w.gully} />
      <path fill={`url(#${id}-labs)`} d={w.labs} />
      <rect x={w.bar.x} y={w.bar.y} width={w.bar.width} height={w.bar.height} fill={`url(#${id}-bar)`} />
    </svg>
  )
}
