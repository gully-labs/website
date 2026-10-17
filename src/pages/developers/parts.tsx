import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'

/* Small components shared by the dashboard's panels (Dashboard, Billing, Alerts); class strings are in styles.ts. */

export function ErrorLine({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-input border border-[#5a2a24] bg-[rgba(255,138,122,.06)] px-4 py-3 text-[14px] text-error" role="alert">
      <AlertTriangle size={16} aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-mono text-[12px] text-ink-2 underline underline-offset-4 hover:text-ink">
          Retry
        </button>
      )}
    </div>
  )
}

export function Skeleton({ h = 20, w = '100%' }: { h?: number; w?: number | string }) {
  return <span aria-hidden className="block animate-shimmer rounded-[4px] bg-[linear-gradient(90deg,#131820_0%,#1a2029_50%,#131820_100%)] bg-[length:200%_100%]" style={{ height: h, width: w }} />
}

/** A dashed empty state with a softly pulsing icon (it is waiting for something, not dead), a title, a
    line of text and an optional next action. */
export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="relative flex flex-col items-center gap-3 overflow-hidden rounded-input border border-dashed border-line-strong px-6 py-10 text-center" data-empty>
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(232,192,96,.45),transparent)]" style={{ animation: 'gl-scan 3.6s linear infinite' }} />
      <span className="relative grid size-14 place-items-center">
        <span aria-hidden className="absolute inset-0 rounded-full border border-gold-line" style={{ animation: 'gl-live-pulse 2.6s ease-out infinite' }} />
        <span aria-hidden className="absolute inset-[6px] rounded-full bg-[rgba(232,192,96,.07)]" style={{ animation: 'gl-skeleton 2.4s ease-in-out infinite' }} />
        <span className="relative">{icon}</span>
      </span>
      <span className="font-display text-[22px] font-bold uppercase">{title}</span>
      <span className="max-w-[460px] text-[14px] text-muted">{children}</span>
      {action && <span className="flex flex-wrap justify-center gap-2">{action}</span>}
    </div>
  )
}
