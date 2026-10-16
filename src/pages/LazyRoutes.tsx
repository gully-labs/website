import { lazy, Suspense } from 'react'

// Each of these is its own chunk; the landing never loads them.
const Widget = lazy(() => import('./widget/WidgetPage').then((m) => ({ default: m.WidgetPage })))
const Developers = lazy(() => import('./developers/DevelopersPage').then((m) => ({ default: m.DevelopersPage })))
const Admin = lazy(() => import('./admin/AdminPage').then((m) => ({ default: m.AdminPage })))

const fallback = <p className="px-page py-24 font-mono text-[13px] text-faint">Loading…</p>

export function WidgetRoute() {
  return (
    <Suspense fallback={fallback}>
      <Widget />
    </Suspense>
  )
}

export function DevelopersRoute() {
  return (
    <Suspense fallback={fallback}>
      <Developers />
    </Suspense>
  )
}

export function AdminRoute() {
  return (
    <Suspense fallback={fallback}>
      <Admin />
    </Suspense>
  )
}
