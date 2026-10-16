import { createBrowserRouter, Navigate } from 'react-router'
import { Layout } from './components/Layout'
import { docsRoutes } from './docs/routes'
import { About } from './pages/About'
import { Home } from './pages/Home'
import { AdminRoute, DevelopersRoute, WidgetRoute } from './pages/LazyRoutes'
import { ProjectDetail } from './pages/ProjectDetail'
import { Services } from './pages/Services'
import { TrackerRoute } from './pages/TrackerRoute'
import { isDocsHost } from './site-host'

const mainRoutes = [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/projects/:slug', element: <ProjectDetail /> },
      { path: '/services', element: <Services /> },
      { path: '/about', element: <About /> },
      { path: '/tracker', element: <TrackerRoute /> },
      { path: '/widget', element: <WidgetRoute /> },
      { path: '/developers', element: <DevelopersRoute /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
  // The admin dashboard has its own chrome: no site header, footer or contact band.
  { path: '/admin', element: <AdminRoute /> },
  // Development only: the docs site under /docs on the main host. In production it lives on its own host.
  { path: '/docs', children: docsRoutes },
]

export const router = createBrowserRouter(isDocsHost() ? docsRoutes : mainRoutes)
