import { createBrowserRouter, Navigate } from 'react-router'
import { Layout } from './components/Layout'
import { docsRoutes } from './docs/routes'
import { Home } from './pages/Home'
import { AboutRoute, AdminRoute, AnalyticsRoute, AskRoute, ChainKitRoute, DevelopersRoute, NotFoundRoute, PayLinkRoute, PayRoute, PricingRoute, ProjectDetailRoute, HoldersRoute, EmbedHoldersRoute, ReceiptRoute, ServicesRoute, StockRoute, TgRoute, TrackerRoute, WidgetRoute } from './pages/LazyRoutes'
import { GoTo, ToSite } from './pages/GoTo'
import { CheckoutRoot } from './pages/pay/CheckoutFrame'
import { RouteError } from './pages/RouteError'
import { ADMIN_URL, APP_URL, isAdminHost, isAppHost, isDocsHost, isLocalHost } from './site-host'

const mainRoutes = [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/projects/:slug', element: <ProjectDetailRoute /> },
      { path: '/services', element: <ServicesRoute /> },
      { path: '/about', element: <AboutRoute /> },
      { path: '/tracker', element: <TrackerRoute /> },
      { path: '/tracker/:chain/:ticker', element: <StockRoute /> },
      { path: '/holders/:chain/:token', element: <HoldersRoute /> },
      { path: '/widget', element: <WidgetRoute /> },
      { path: '/pricing', element: <PricingRoute /> },
      { path: '/analytics', element: <AnalyticsRoute /> },
      { path: '/chain-kit', element: <ChainKitRoute /> },
      { path: '/ask', element: <AskRoute /> },
      // The Gully Pay merchant terms (the checkout's footer links here).
      { path: '/legal/merchant-terms', lazy: () => import('./pages/legal/MerchantTerms').then((m) => ({ Component: m.MerchantTermsPage })) },
      { path: '/gully-pay/merchant-terms', element: <Navigate to="/legal/merchant-terms" replace /> },
      // A path no page owns: a branded 404 with ways back (the server answers it with status 404).
      { path: '*', element: <NotFoundRoute /> },
    ],
  },
  // The admin dashboard lives on its own host. Locally it is also at /admin; anywhere else /admin
  // sends you there (the server answers that path with a 301 before the app even loads).
  { path: '/admin', element: isLocalHost() ? <AdminRoute /> : <GoTo url={ADMIN_URL} /> },
  // The Gully Labs App lives on app.gullylabs.xyz, full screen with its own sidebar. Locally it is at /app
  // and, under its old name, /developers; anywhere else both leave for the app (the server 301s first).
  { path: '/app', element: isLocalHost() ? <DevelopersRoute /> : <GoTo url={APP_URL} /> },
  { path: '/developers', element: isLocalHost() ? <DevelopersRoute /> : <GoTo url={APP_URL} /> },
  // The Telegram Mini App (opened from @GullyLabsBot): full screen in Telegram's own chrome, no site header or footer.
  { path: '/tg', element: <TgRoute /> },
  // The embeddable Holder Map (widget.js data-gully-widget="holders"): framed by other sites, no site chrome.
  { path: '/embed/holders/:chain/:token', element: <EmbedHoldersRoute /> },
  // Gully Pay's standalone checkout (src/pages/pay/CheckoutFrame): its own layout, no site header, nav or
  // footer. Never linked from the site, never indexed; whoever holds the link pays here.
  {
    element: <CheckoutRoot />,
    children: [
      // An invoice anyone with its link can pay, and its printable receipt once paid.
      { path: '/pay/:id', element: <PayRoute /> },
      { path: '/pay/:id/receipt', element: <ReceiptRoute /> },
      // A reusable pay link: makes an invoice per payer, then hands over to /pay/:id.
      { path: '/pay/l/:id', element: <PayLinkRoute /> },
      // Gully Pay for merchants: a store's invoice and link checkouts (paid to the store's wallet) and receipts.
      { path: '/pay/m/:id', lazy: () => import('./pages/merchant-pay/MerchantPay').then((m) => ({ Component: m.MerchantInvoicePage })) },
      { path: '/pay/m/:id/receipt', lazy: () => import('./pages/merchant-pay/MerchantPay').then((m) => ({ Component: m.MerchantReceiptPage })) },
      { path: '/pay/m/l/:id', lazy: () => import('./pages/merchant-pay/MerchantPay').then((m) => ({ Component: m.MerchantLinkPage })) },
    ],
  },
  // Development only: the docs site under /docs on the main host. In production it lives on its own host.
  { path: '/docs', children: docsRoutes },
]

// On the admin host every path is the dashboard; it has its own chrome (no site header or footer).
const adminRoutes = [{ path: '*', element: <AdminRoute /> }]

// On the app host (and developers.*, its old name) the dashboard is the home page; every other page
// belongs to the main site, so it leaves for it with the same path.
// The app is full-screen: it draws its own sidebar and header, so no site Layout here.
const appRoutes = [
  { path: '/', element: <DevelopersRoute /> },
  { path: '*', element: <ToSite /> },
]

const routes = isAdminHost() ? adminRoutes : isDocsHost() ? docsRoutes : isAppHost() ? appRoutes : mainRoutes

// One error boundary over every host's routes: a page left open across a deploy reloads onto the new
// build instead of showing React Router's default error screen.
export const router = createBrowserRouter([{ errorElement: <RouteError />, children: routes }])
