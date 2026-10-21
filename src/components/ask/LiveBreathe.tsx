import type { CSSProperties, ReactNode } from 'react'
import { useInView } from '../charts/useMiniChart'

/* Keeps a chart the chart kit has no live behaviour for (a ring, horizontal bars, the tracker's gap
   bars) from sitting still after its draw-in: the kit's slow breathing (gl-live-breathe, CSS only)
   runs over it, paused while off-screen (data-live) and gentler, never off, under reduced motion. */
export function LiveBreathe({ children, depth = 0.8, className = '' }: { children: ReactNode; depth?: number; className?: string }) {
  const [ref, inView] = useInView<HTMLDivElement>()
  return (
    <div ref={ref} data-live={inView ? 'on' : 'paused'} data-live-breathe="" className={className}>
      <div className="gl-live-breathe" style={{ '--gl-breathe-lo': depth } as CSSProperties}>
        {children}
      </div>
    </div>
  )
}
