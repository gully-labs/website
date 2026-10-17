import { createBrowserRouter, Navigate } from 'react-router'
import { Layout } from './components/Layout'
import { docsRoutes } from './docs/routes'
import { Home } from './pages/Home'
import { AboutRoute, AdminRoute, AnalyticsRoute, ChainKitRoute, DevelopersRoute, PayRoute, PricingRoute, ProjectDetailRoute, ReceiptRoute, ServicesRoute, StockRoute, WidgetRoute } from './pages/LazyRoutes'
import { GoTo, ToSite } from './pages/GoTo'
import { RouteError } from './pages/RouteError'
import { TrackerRoute } from './pages/TrackerRoute'
import { ADMIN_URL, DEVELOPERS_URL, isAdminHost, isDevelopersHost, isDocsHost, isLocalHost } from './site-host'

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
      { path: '/widget', element: <WidgetRoute /> },
      { path: '/pricing', element: <PricingRoute /> },
      { path: '/analytics', element: <AnalyticsRoute /> },
      { path: '/chain-kit', element: <ChainKitRoute /> },
      { path: '/ask', lazy: () => import('./pages/ask/AskPage').then((m) => ({ Component: m.AskPage })) },
      // Gully Pay: an invoice anyone with its link can pay (never linked, never indexed).
      { path: '/pay/:id', element: <PayRoute /> },
      { path: '/developers', element: isLocalHost() ? <DevelopersRoute /> : <GoTo url={DEVELOPERS_URL} /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
  // The admin dashboard lives on its own host. Locally it is also at /admin; anywhere else /admin
  // sends you there (the server answers that path with a 301 before the app even loads).
  { path: '/admin', element: isLocalHost() ? <AdminRoute /> : <GoTo url={ADMIN_URL} /> },
  // A paid invoice's receipt prints on its own, without the site's header and footer.
  { path: '/pay/:id/receipt', element: <ReceiptRoute /> },
  // Development only: the docs site under /docs on the main host. In production it lives on its own host.
  { path: '/docs', children: docsRoutes },
]

// On the admin host every path is the dashboard; it has its own chrome (no site header or footer).
const adminRoutes = [{ path: '*', element: <AdminRoute /> }]

// On the developers host the dashboard is the home page, inside the site chrome; every other page
// belongs to the main site, so it leaves for it with the same path.
const developersRoutes = [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <DevelopersRoute /> },
      { path: '*', element: <ToSite /> },
    ],
  },
]

const routes = isAdminHost() ? adminRoutes : isDocsHost() ? docsRoutes : isDevelopersHost() ? developersRoutes : mainRoutes

// One error boundary over every host's routes: a page left open across a deploy reloads onto the new
// build instead of showing React Router's default error screen.
export const router = createBrowserRouter([{ errorElement: <RouteError />, children: routes }])
