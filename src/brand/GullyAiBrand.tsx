import type { ReactNode } from 'react'
import { PRODUCT_BRANDS } from './products'

const AI = PRODUCT_BRANDS.gullyai

/** The Gully AI kit logo (downscaled, edges feathered into its own backdrop colour, #000406), in a box of the file's own
    ratio at `height`. The box may shrink with its container (max-width 100%); the image is letterboxed inside it
    (object-fit: contain, left-aligned), so the logo is never squashed. 1x and 2x files. */
export function GullyAiLogo({ height = 40, className = '' }: { height?: number; className?: string }) {
  const width = Math.round((height * AI.logo.w) / AI.logo.h)
  return (
    <span className={`relative block max-w-full shrink-0 ${className}`} style={{ height, width }} data-product-logo="gullyai">
      <img
        src={AI.logo.src}
        srcSet={`${AI.logo.src} 1x, ${AI.logo.src2x} 2x`}
        width={AI.logo.w / 2}
        height={AI.logo.h / 2}
        alt="Gully AI"
        decoding="async"
        draggable={false}
        className="absolute inset-0 h-full w-full object-contain object-left"
      />
    </span>
  )
}

/** A Gully AI surface: its kit palette for everything inside ([data-product-brand='gullyai'] in src/index.css). */
export function GullyAiScope({ children, className = '', as: Tag = 'div', ...rest }: { children: ReactNode; className?: string; as?: 'div' | 'section'; 'aria-label'?: string; 'data-testid'?: string }) {
  return (
    <Tag data-product-brand="gullyai" className={className} {...rest}>
      {children}
    </Tag>
  )
}

/** The logo and one kit mascot on the logo's backdrop: the head of a Gully AI page (the docs). A fixed-height band:
    the logo sits in its own-ratio box, the mascot in a square box, both letterboxed (object-fit: contain). */
export function GullyAiBanner({ children }: { children?: ReactNode }) {
  return (
    <GullyAiScope className="flex min-h-[88px] items-center justify-between gap-4 overflow-hidden rounded-card border border-line bg-bg px-5 py-3" data-testid="gullyai-banner">
      <div className="flex min-w-0 flex-col gap-2">
        <GullyAiLogo height={48} />
        {children && <p className="m-0 text-[14px] leading-[1.5] text-muted">{children}</p>}
      </div>
      <span className="relative block size-16 shrink-0 max-[480px]:hidden" aria-hidden>
        <img src={AI.mascot.src} width={AI.mascot.w} height={AI.mascot.h} alt="" decoding="async" draggable={false} className="absolute inset-0 h-full w-full object-contain" />
      </span>
    </GullyAiScope>
  )
}
