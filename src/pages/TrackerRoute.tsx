import { lazy, Suspense } from 'react'

// The tracker is its own chunk: the landing never pays for it.
const Tracker = lazy(() => import('./Tracker').then((m) => ({ default: m.Tracker })))

export function TrackerRoute() {
  return (
    <Suspense fallback={<p className="px-page py-24 font-mono text-[13px] text-faint">Loading the tracker…</p>}>
      <Tracker />
    </Suspense>
  )
}
