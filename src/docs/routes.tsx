// The docs site's routes: mounted at the root of docs.gullylabs.xyz and under /docs on the main host
// in development, so every path here is RELATIVE. Each page is its own chunk; the marketing site never
// loads them.
import type { RouteObject } from 'react-router'
import { useEffect } from 'react'
import { MOVED_DOCS } from './nav'

/** A docs page that moved to a product's own domain: go there (replacing this history entry). */
function LeaveFor({ url }: { url: string }) {
  useEffect(() => window.location.replace(url), [url])
  return <p className="px-6 py-24 font-mono text-[13px] text-faint">This page moved to <a href={url}>{url.replace('https://', '')}</a>.</p>
}

export const docsRoutes: RouteObject[] = [
  {
    lazy: () => import('./DocsLayout').then((m) => ({ Component: m.DocsLayout })),
    // Shown for the moment the first chunk takes to arrive.
    hydrateFallbackElement: <p className="px-6 py-24 font-mono text-[13px] text-faint">Loading the docs…</p>,
    children: [
      { index: true, lazy: () => import('./pages/Overview').then((m) => ({ Component: m.Overview })) },
      { path: 'integrate', lazy: () => import('./pages/IntegrateDocs').then((m) => ({ Component: m.IntegrateDocs })) },
      { path: 'integrate', lazy: () => import('./pages/IntegrateDocs').then((m) => ({ Component: m.IntegrateDocs })) },
      { path: 'methodology', lazy: () => import('./pages/Methodology').then((m) => ({ Component: m.Methodology })) },
      { path: 'api', lazy: () => import('./pages/ApiReference').then((m) => ({ Component: m.ApiReference })) },
      { path: 'widget', lazy: () => import('./pages/WidgetGuide').then((m) => ({ Component: m.WidgetGuide })) },
      { path: 'sdk', lazy: () => import('./pages/Sdk').then((m) => ({ Component: m.Sdk })) },
      { path: 'api-keys', lazy: () => import('./pages/ApiKeys').then((m) => ({ Component: m.ApiKeys })) },
      { path: 'plans-alerts', lazy: () => import('./pages/PlansAlerts').then((m) => ({ Component: m.PlansAlerts })) },
      { path: 'badges', lazy: () => import('./pages/BadgesDocs').then((m) => ({ Component: m.BadgesDocs })) },
      { path: 'teams', lazy: () => import('./pages/Teams').then((m) => ({ Component: m.Teams })) },
      { path: 'holder-map', lazy: () => import('./pages/HolderMapDocs').then((m) => ({ Component: m.HolderMapDocs })) },
      { path: 'holder-map-integrate', lazy: () => import('./pages/HolderMapIntegrateDocs').then((m) => ({ Component: m.HolderMapIntegrateDocs })) },
      { path: 'analytics', lazy: () => import('./pages/AnalyticsDocs').then((m) => ({ Component: m.AnalyticsDocs })) },
      { path: 'gully-security', lazy: () => import('./pages/GullySecurityDocs').then((m) => ({ Component: m.GullySecurityDocs })) },
      { path: 'gully-score', lazy: () => import('./pages/GullyScore').then((m) => ({ Component: m.GullyScore })) },
      { path: 'gully-ai', lazy: () => import('./pages/GullyAiDocs').then((m) => ({ Component: m.GullyAiDocs })) },
      { path: 'telegram', lazy: () => import('./pages/TelegramDocs').then((m) => ({ Component: m.TelegramDocs })) },
      { path: 'telegram-mini-app', lazy: () => import('./pages/TelegramMiniAppDocs').then((m) => ({ Component: m.TelegramMiniAppDocs })) },
      { path: 'news-gate', lazy: () => import('./pages/NewsGateDocs').then((m) => ({ Component: m.NewsGateDocs })) },
      { path: 'stock-pages', lazy: () => import('./pages/StockPagesDocs').then((m) => ({ Component: m.StockPagesDocs })) },
      { path: 'swaps', lazy: () => import('./pages/SwapsDocs').then((m) => ({ Component: m.SwapsDocs })) },
      { path: 'solana', lazy: () => import('./pages/SolanaDocs').then((m) => ({ Component: m.SolanaDocs })) },
      { path: 'solana-pay', lazy: () => import('./pages/SolanaPayDocs').then((m) => ({ Component: m.SolanaPayDocs })) },
      { path: 'ipfs', lazy: () => import('./pages/IpfsDocs').then((m) => ({ Component: m.IpfsDocs })) },
      { path: 'contracts', lazy: () => import('./pages/ContractsDocs').then((m) => ({ Component: m.ContractsDocs })) },
      { path: 'status', lazy: () => import('./pages/StatusDocs').then((m) => ({ Component: m.StatusDocs })) },
      { path: 'roadmap', lazy: () => import('./pages/Roadmap').then((m) => ({ Component: m.Roadmap })) },
      // Moved to the products' own docs: in production the server 301s these first; here they leave the same way.
      ...Object.entries(MOVED_DOCS).map(([path, url]) => ({ path, element: <LeaveFor url={url} /> })),
      { path: 'changelog', lazy: () => import('./pages/Changelog').then((m) => ({ Component: m.Changelog })) },
      { path: '*', lazy: () => import('./pages/NotFound').then((m) => ({ Component: m.NotFound })) },
    ],
  },
]
