import type { ReactNode } from 'react'
import { useInView } from '../charts/useMiniChart'

/* A live strip above a chart whose data the page re-reads on a timer: a pulsing dot and the cadence, in the
   kit's live CSS (gl-live-ring, paused off-screen). Bar charts only move when new numbers arrive, so on a
   phone, where the desktop header's dot is hidden, this is what shows the chart is alive. It says only what
   the page does: the cadence is the page's own poll interval. */
export function LivePulse({ source, every, children }: { source: string; every: string; children: ReactNode }) {
  const [ref, inView] = useInView<HTMLDivElement>()
  return (
    <div ref={ref} data-live={inView ? 'on' : 'paused'} data-testid="live-pulse" className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center justify-end gap-2 text-right font-mono text-[11px] text-muted">
        <span aria-hidden className="relative inline-block size-[7px] flex-none">
          <span className="gl-live-ring absolute inset-0 rounded-full bg-green" />
          <span className="absolute inset-0 rounded-full bg-green" />
        </span>
        <span className="min-w-0 break-words">
          LIVE · {source} · every {every}
        </span>
      </div>
      {children}
    </div>
  )
}
