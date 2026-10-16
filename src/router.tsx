import { createBrowserRouter, Navigate } from 'react-router'
import { Layout } from './components/Layout'
import { docsRoutes } from './docs/routes'
import { Home } from './pages/Home'
import { AboutRoute, AdminRoute, DevelopersRoute, ProjectDetailRoute, ServicesRoute, WidgetRoute } from './pages/LazyRoutes'
import { GoTo } from './pages/GoTo'
import { TrackerRoute } from './pages/TrackerRoute'
import { ADMIN_URL, isAdminHost, isDocsHost, isLocalHost } from './site-host'

const mainRoutes = [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/projects/:slug', element: <ProjectDetailRoute /> },
      { path: '/services', element: <ServicesRoute /> },
      { path: '/about', element: <AboutRoute /> },
      { path: '/tracker', element: <TrackerRoute /> },
      { path: '/widget', element: <WidgetRoute /> },
      { path: '/developers', element: <DevelopersRoute /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
  // The admin dashboard lives on its own host. Locally it is also at /admin; anywhere else /admin
  // sends you there (the server answers that path with a 301 before the app even loads).
  { path: '/admin', element: isLocalHost() ? <AdminRoute /> : <GoTo url={ADMIN_URL} /> },
  // Development only: the docs site under /docs on the main host. In production it lives on its own host.
  { path: '/docs', children: docsRoutes },
]

// On the admin host every path is the dashboard; it has its own chrome (no site header or footer).
const adminRoutes = [{ path: '*', element: <AdminRoute /> }]

export const router = createBrowserRouter(isAdminHost() ? adminRoutes : isDocsHost() ? docsRoutes : mainRoutes)
