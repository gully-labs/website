import { createBrowserRouter, Navigate } from 'react-router'
import { Layout } from './components/Layout'
import { About } from './pages/About'
import { Home } from './pages/Home'
import { ProjectDetail } from './pages/ProjectDetail'
import { Services } from './pages/Services'

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/projects/:slug', element: <ProjectDetail /> },
      { path: '/services', element: <Services /> },
      { path: '/about', element: <About /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
