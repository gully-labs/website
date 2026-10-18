import { lazy, Suspense, type ReactNode } from 'react'
import { CheckoutSkeleton } from './pay/CheckoutFrame'
import { chunks } from './routeChunks'

// Each of these is its own chunk; the landing never loads them.
const Widget = lazy(() => chunks.widget().then((m) => ({ default: m.WidgetPage })))
const Developers = lazy(() => chunks.developers().then((m) => ({ default: m.DevelopersPage })))
const Services = lazy(() => chunks.services().then((m) => ({ default: m.Services })))
const About = lazy(() => chunks.about().then((m) => ({ default: m.About })))
const ProjectDetail = lazy(() => chunks.project().then((m) => ({ default: m.ProjectDetail })))
const Pricing = lazy(() => chunks.pricing().then((m) => ({ default: m.Pricing })))
const Admin = lazy(() => chunks.admin().then((m) => ({ default: m.AdminPage })))
const Pay = lazy(() => chunks.pay().then((m) => ({ default: m.PayPage })))
const Receipt = lazy(() => chunks.receipt().then((m) => ({ default: m.Receipt })))
const PayLink = lazy(() => chunks.payLink().then((m) => ({ default: m.LinkPage })))
const Analytics = lazy(() => chunks.products().then((m) => ({ default: m.Analytics })))
const ChainKit = lazy(() => chunks.products().then((m) => ({ default: m.ChainKit })))
const Stock = lazy(() => chunks.stock().then((m) => ({ default: m.StockPage })))
const Tracker = lazy(() => chunks.tracker().then((m) => ({ default: m.Tracker })))
const Ask = lazy(() => chunks.ask().then((m) => ({ default: m.AskPage })))
const Security = lazy(() => chunks.security().then((m) => ({ default: m.SecurityPage })))
const SecurityReports = lazy(() => chunks.securityReports().then((m) => ({ default: m.ReportsIndex })))
const SecurityReport = lazy(() => chunks.securityReports().then((m) => ({ default: m.PublicReportPage })))
const NotFound = lazy(() => chunks.notFound().then((m) => ({ default: m.NotFound })))
const Links = lazy(() => chunks.links().then((m) => ({ default: m.LinksPage })))
const Tg = lazy(() => chunks.tg().then((m) => ({ default: m.TgApp })))

/** What a page shows while its chunk loads: a pulsing page outline a full screen tall, so the closing
    band and the footer stay below the fold instead of flashing up and jumping down (CLS). */
export function RouteSkeleton() {
  const bar = 'gl-skeleton rounded-card bg-surface'
  return (
    <div role="status" aria-label="Loading the page" className="flex min-h-[100svh] flex-col gap-6 px-page pt-[72px] pb-24 max-[600px]:pt-10">
      <div className={`${bar} h-[14px] w-[180px] rounded-full`} />
      <div className={`${bar} h-[clamp(48px,6cqw,88px)] w-[min(720px,100%)]`} />
      <div className={`${bar} h-[18px] w-[min(560px,100%)] rounded-full`} />
      <div className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-4">
        <div className={`${bar} h-[180px]`} />
        <div className={`${bar} h-[180px]`} />
        <div className={`${bar} h-[180px]`} />
      </div>
      <div className={`${bar} h-[320px]`} />
    </div>
  )
}

const page = (node: ReactNode) => <Suspense fallback={<RouteSkeleton />}>{node}</Suspense>
// The standalone checkout has its own outline (no site chrome around it).
const checkout = (node: ReactNode) => <Suspense fallback={<CheckoutSkeleton />}>{node}</Suspense>

export const WidgetRoute = () => page(<Widget />)
export const DevelopersRoute = () => page(<Developers />)
export const AnalyticsRoute = () => page(<Analytics />)
export const ChainKitRoute = () => page(<ChainKit />)
export const StockRoute = () => page(<Stock />)
export const PricingRoute = () => page(<Pricing />)
export const PayRoute = () => checkout(<Pay />)
export const PayLinkRoute = () => checkout(<PayLink />)
export const ReceiptRoute = () => checkout(<Receipt />)
export const AdminRoute = () => page(<Admin />)
export const ServicesRoute = () => page(<Services />)
export const AboutRoute = () => page(<About />)
export const ProjectDetailRoute = () => page(<ProjectDetail />)
export const TrackerRoute = () => page(<Tracker />)
export const AskRoute = () => page(<Ask />)
export const SecurityRoute = () => page(<Security />)
export const SecurityReportsRoute = () => page(<SecurityReports />)
export const SecurityReportRoute = () => page(<SecurityReport />)
export const NotFoundRoute = () => page(<NotFound />)
export const LinksRoute = () => page(<Links />)
// The Telegram Mini App draws its own loading state; a blank screen in Telegram's colours meanwhile.
export const TgRoute = () => (
  <Suspense fallback={<div role="status" aria-label="Loading" className="min-h-[100svh]" />}>
    <Tg />
  </Suspense>
)
