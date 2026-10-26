import type { ReactNode } from 'react'
import { PRODUCT_BRANDS } from './products'

const AI = PRODUCT_BRANDS.gullyai

/** The Gully AI kit logo (downscaled, edges feathered into its own backdrop colour, #000406). */
export function GullyAiLogo({ height = 40, className = '' }: { height?: number; className?: string }) {
  return (
    <img
      src={AI.logo.src}
      srcSet={`${AI.logo.src} 1x, ${AI.logo.src2x} 2x`}
      width={Math.round((height * AI.logo.w) / AI.logo.h)}
      height={height}
      alt="Gully AI"
      decoding="async"
      draggable={false}
      data-product-logo="gullyai"
      className={`block max-w-full shrink-0 ${className}`}
      style={{ height, width: 'auto' }}
    />
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

/** The logo and one kit mascot on the logo's backdrop: the head of a Gully AI page (docs, the app's AI view). */
export function GullyAiBanner({ children }: { children?: ReactNode }) {
  return (
    <GullyAiScope className="flex items-center justify-between gap-4 overflow-hidden rounded-card border border-line bg-bg px-5 py-3" data-testid="gullyai-banner">
      <div className="flex min-w-0 flex-col gap-2">
        <GullyAiLogo height={48} />
        {children && <p className="m-0 text-[14px] leading-[1.5] text-muted">{children}</p>}
      </div>
      <img src={AI.mascot.src} width={96} height={95} alt="" aria-hidden decoding="async" className="block shrink-0 max-[480px]:hidden" style={{ width: 96, height: 'auto' }} />
    </GullyAiScope>
  )
}
