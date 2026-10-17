import { lazy, Suspense } from 'react'

// Each of these is its own chunk; the landing never loads them.
const Widget = lazy(() => import('./widget/WidgetPage').then((m) => ({ default: m.WidgetPage })))
const Developers = lazy(() => import('./developers/DevelopersPage').then((m) => ({ default: m.DevelopersPage })))
const Services = lazy(() => import('./Services').then((m) => ({ default: m.Services })))
const About = lazy(() => import('./About').then((m) => ({ default: m.About })))
const ProjectDetail = lazy(() => import('./ProjectDetail').then((m) => ({ default: m.ProjectDetail })))
const Pricing = lazy(() => import('./Pricing').then((m) => ({ default: m.Pricing })))
const Admin = lazy(() => import('./admin/AdminPage').then((m) => ({ default: m.AdminPage })))
const Pay = lazy(() => import('./pay/PayPage').then((m) => ({ default: m.PayPage })))
const Receipt = lazy(() => import('./pay/Receipt').then((m) => ({ default: m.Receipt })))

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

const Analytics = lazy(() => import('./Products').then((m) => ({ default: m.Analytics })))
const ChainKit = lazy(() => import('./Products').then((m) => ({ default: m.ChainKit })))

export function AnalyticsRoute() {
  return (
    <Suspense fallback={fallback}>
      <Analytics />
    </Suspense>
  )
}

export function ChainKitRoute() {
  return (
    <Suspense fallback={fallback}>
      <ChainKit />
    </Suspense>
  )
}

const Stock = lazy(() => import('./StockPage').then((m) => ({ default: m.StockPage })))

export function StockRoute() {
  return (
    <Suspense fallback={fallback}>
      <Stock />
    </Suspense>
  )
}

export function PricingRoute() {
  return (
    <Suspense fallback={fallback}>
      <Pricing />
    </Suspense>
  )
}

export function PayRoute() {
  return (
    <Suspense fallback={fallback}>
      <Pay />
    </Suspense>
  )
}

export function ReceiptRoute() {
  return (
    <Suspense fallback={fallback}>
      <Receipt />
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

export function ServicesRoute() {
  return (
    <Suspense fallback={fallback}>
      <Services />
    </Suspense>
  )
}

export function AboutRoute() {
  return (
    <Suspense fallback={fallback}>
      <About />
    </Suspense>
  )
}

export function ProjectDetailRoute() {
  return (
    <Suspense fallback={fallback}>
      <ProjectDetail />
    </Suspense>
  )
}
