// The docs site's routes: mounted at the root of docs.gullylabs.xyz and under /docs on the main host
// in development, so every path here is RELATIVE. Each page is its own chunk; the marketing site never
// loads them.
import type { RouteObject } from 'react-router'

export const docsRoutes: RouteObject[] = [
  {
    lazy: () => import('./DocsLayout').then((m) => ({ Component: m.DocsLayout })),
    // Shown for the moment the first chunk takes to arrive.
    hydrateFallbackElement: <p className="px-6 py-24 font-mono text-[13px] text-faint">Loading the docs…</p>,
    children: [
      { index: true, lazy: () => import('./pages/Overview').then((m) => ({ Component: m.Overview })) },
      { path: 'methodology', lazy: () => import('./pages/Methodology').then((m) => ({ Component: m.Methodology })) },
      { path: 'api', lazy: () => import('./pages/ApiReference').then((m) => ({ Component: m.ApiReference })) },
      { path: 'widget', lazy: () => import('./pages/WidgetGuide').then((m) => ({ Component: m.WidgetGuide })) },
      { path: 'sdk', lazy: () => import('./pages/Sdk').then((m) => ({ Component: m.Sdk })) },
      { path: 'api-keys', lazy: () => import('./pages/ApiKeys').then((m) => ({ Component: m.ApiKeys })) },
      { path: 'plans-alerts', lazy: () => import('./pages/PlansAlerts').then((m) => ({ Component: m.PlansAlerts })) },
      { path: 'changelog', lazy: () => import('./pages/Changelog').then((m) => ({ Component: m.Changelog })) },
      { path: '*', lazy: () => import('./pages/NotFound').then((m) => ({ Component: m.NotFound })) },
    ],
  },
]
