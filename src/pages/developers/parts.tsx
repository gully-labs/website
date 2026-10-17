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

/** A dashed empty state with an icon, a title and a line of text. */
export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-input border border-dashed border-line-strong px-6 py-10 text-center">
      {icon}
      <span className="font-display text-[22px] font-bold uppercase">{title}</span>
      <span className="max-w-[460px] text-[14px] text-muted">{children}</span>
    </div>
  )
}
