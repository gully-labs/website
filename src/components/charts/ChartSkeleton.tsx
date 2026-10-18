/* Placeholders that hold a chart's box while it loads, and the inline failure state with a retry.
   The skeleton pulses softly (gl-skeleton); under reduced motion index.css stills it at a steady
   tint. Neither shifts the layout: both fill the box they are given. */

export type SkeletonVariant = 'bars' | 'line' | 'ring'

const BARS = [42, 64, 38, 80, 56, 70, 48, 62]

/** A soft pulsing stand-in for a chart, filling its (positioned) parent. */
export function ChartSkeleton({ variant = 'bars', className = '' }: { variant?: SkeletonVariant; className?: string }) {
  const pulse = (i: number) => ({ animation: `gl-skeleton 1.6s ${(i * 0.08).toFixed(2)}s ease-in-out infinite` })
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden rounded-input ${className}`}>
      {variant === 'bars' && (
        <div className="flex size-full items-end gap-[5%] px-[4%] pb-3">
          {BARS.map((h, i) => (
            <span key={i} className="flex-1 rounded-t-bar bg-line" style={{ height: `${h}%`, ...pulse(i) }} />
          ))}
        </div>
      )}
      {variant === 'line' && (
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="size-full" style={pulse(0)}>
          <path d="M0,30 L12,26 L24,28 L36,18 L48,22 L60,12 L72,16 L84,8 L100,12 L100,40 L0,40 Z" fill="#1f2935" />
          <path d="M0,30 L12,26 L24,28 L36,18 L48,22 L60,12 L72,16 L84,8 L100,12" fill="none" stroke="#2a3542" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      {variant === 'ring' && (
        <div className="grid size-full place-items-center">
          <span className="aspect-square h-[84%] rounded-full border-[12px] border-line" style={pulse(0)} />
        </div>
      )}
    </div>
  )
}

/** "Couldn't load" inside the chart's box, with a retry button when the caller can retry. */
export function ChartError({ message = "Couldn't load this chart.", onRetry, className = '' }: { message?: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={`absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-input border border-dashed border-line-strong bg-surface-deep/60 p-4 text-center ${className}`}>
      <span className="font-mono text-[12px] leading-[1.5] text-faint">{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-btn border border-line-strong bg-transparent px-4 font-mono text-[12px] text-ink-2 transition-colors hover:border-gold hover:text-gold"
        >
          Retry
        </button>
      )}
    </div>
  )
}

/**
 * A fixed-height chart box for states that have no chart yet: loading (skeleton) or failed (error
 * with retry). Use it where a chart's data comes from a fetch, so the page does not jump.
 */
export function ChartBox({ height, state, variant, message, onRetry, children }: { height: number | string; state: 'loading' | 'error'; variant?: SkeletonVariant; message?: string; onRetry?: () => void; children?: React.ReactNode }) {
  return (
    <div className="relative w-full" style={{ height }} aria-busy={state === 'loading' || undefined}>
      {state === 'loading' ? <ChartSkeleton variant={variant} /> : <ChartError message={message} onRetry={onRetry} />}
      {children}
    </div>
  )
}
