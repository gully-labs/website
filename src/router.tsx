import { createBrowserRouter, Navigate } from 'react-router'
import { Layout } from './components/Layout'
import { docsRoutes } from './docs/routes'
import { Constellation } from './pages/hub/Constellation'
import { AboutRoute, AdminRoute, AnalyticsRoute, AskRoute, DevelopersRoute, EmbedHoldersRoute, HmLandingRoute, HmNotFoundRoute, HoldersDeepRoute, HoldersLandingRoute, HoldersRoute, LinksRoute, NotFoundRoute, PayLinkRoute, PayRoute, PricingRoute, ProjectDetailRoute, ReceiptRoute, SecurityReportRoute, SecurityReportsRoute, SecurityRoute, SecuritySampleRoute, ServicesRoute, StockRoute, TgRoute, TrackerRoute, WidgetRoute } from './pages/LazyRoutes'
import { GoTo, ToSite } from './pages/GoTo'
import { CheckoutRoot } from './pages/pay/CheckoutFrame'
import { RouteError } from './pages/RouteError'
import { ADMIN_URL, APP_URL, isAdminHost, isAppHost, isDocsHost, isEmbedHost, isHolderMapsHost, isLocalHost, isPayHost, isSecurityHost } from './site-host'
import { installHolderMapsLinks } from './lib/holderMapsLinks'
import { installSecurityLinks } from './lib/securityLinks'
import { HolderMapsTokenPage, MainHolderPage, ToShortHolderPath } from './pages/HolderMapsRoutes'
import { MainSecurityPage, ToShortSecurityPath } from './pages/SecurityRoutes'
import { installDelegatedTracking } from './lib/track'
import { HolderMapOpened } from './lib/routeEvents'

// Gully Analytics events for pages whose own files do not send them (link clicks on /links; src/lib/track.ts).
installDelegatedTracking()
// holdermaps.xyz: links to the rest of Gully Labs leave for gullylabs.xyz directly (src/lib/holderMapsLinks.ts).
installHolderMapsLinks()
// gullysecurity.xyz: the same for Gully Security's domain (src/lib/securityLinks.ts).
installSecurityLinks()

// Old paths of the products that moved to their own domains, and the hand-off page each one opens in development.
const MOVED_PATHS = [
  ['/chains/*', 'chain'],
  ['/chains', 'chain'],
  ['/chain-kit', 'chain'],
  ['/gully-pay/*', 'pay'],
  ['/gully-pay', 'pay'],
  ['/rpc/*', 'rpc'],
  ['/rpc', 'rpc'],
  ['/studio/*', 'studio'],
  ['/studio', 'studio'],
  // DeepCore partnership ended 2026-10-29: its launchpad and portfolio pages are Gully Core now (server: hosts.mjs 301)
  ['/products/deepcore', 'gully-core'],
  ['/projects/deepcore', 'gully-core'],
] as const

// Gully Pay's checkout pages (pay.gullylabs.xyz; also /pay on the main host in development).
const payChildren = [
  // An invoice anyone with its link can pay, and its printable receipt once paid.
  { path: '/pay/:id', element: <PayRoute /> },
  { path: '/pay/:id/receipt', element: <ReceiptRoute /> },
  // A reusable pay link: makes an invoice per payer, then hands over to /pay/:id.
  { path: '/pay/l/:id', element: <PayLinkRoute /> },
  // Gully Pay for merchants: a store's invoice and link checkouts (paid to the store's wallet) and receipts.
  { path: '/pay/m/:id', lazy: () => import('./pages/merchant-pay/MerchantPay').then((m) => ({ Component: m.MerchantInvoicePage })) },
  { path: '/pay/m/:id/receipt', lazy: () => import('./pages/merchant-pay/MerchantPay').then((m) => ({ Component: m.MerchantReceiptPage })) },
  { path: '/pay/m/l/:id', lazy: () => import('./pages/merchant-pay/MerchantPay').then((m) => ({ Component: m.MerchantLinkPage })) },
]

const mainRoutes = [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Constellation /> },
      { path: '/projects/:slug', element: <ProjectDetailRoute /> },
      { path: '/services', element: <ServicesRoute /> },
      { path: '/about', element: <AboutRoute /> },
      { path: '/tracker', element: <TrackerRoute /> },
      { path: '/tracker/:chain/:ticker', element: <StockRoute /> },
      { path: '/holders', element: <MainHolderPage><HoldersLandingRoute /></MainHolderPage> },
      { path: '/holders/deep/:id', element: <MainHolderPage><HoldersDeepRoute /></MainHolderPage> },
      { path: '/holders/:chain/:token', element: <MainHolderPage><HolderMapOpened from="holders-page"><HoldersRoute /></HolderMapOpened></MainHolderPage> },
      { path: '/widget', element: <WidgetRoute /> },
      { path: '/pricing', element: <PricingRoute /> },
      { path: '/analytics', element: <AnalyticsRoute /> },
      // Products on their own domains (server/hosts.mjs movedPageUrl): in production the server answers these paths
      // with a 301 to the product's domain first; here (development) they open the product's hand-off page.
      ...MOVED_PATHS.map(([path, key]) => ({ path, element: <Navigate to={`/products/${key}`} replace /> })),
      { path: '/ask', element: <AskRoute /> },
      // The six products (lab console): the list and one compact page each; each links out to its own domain.
      { path: '/products', lazy: () => import('./pages/products/ProductsIndex').then((m) => ({ Component: m.ProductsIndex })) },
      { path: '/products/:key', lazy: () => import('./pages/products/ProductPage').then((m) => ({ Component: m.ProductPage })) },
      // Our own projects with live numbers, what the code integrates with, and the partner page with its two forms.
      { path: '/ecosystem', lazy: () => import('./pages/Ecosystem').then((m) => ({ Component: m.Ecosystem })) },
      { path: '/partners', lazy: () => import('./pages/Partners').then((m) => ({ Component: m.Partners })) },
      // Gully Security: the product page, the published reports and one report (noindex unless its owner opts in).
      // Once gullysecurity.xyz is Security's home (SECURITY_PRIMARY), MainSecurityPage leaves for it.
      { path: '/security', element: <MainSecurityPage><SecurityRoute /></MainSecurityPage> },
      { path: '/security/reports', element: <MainSecurityPage><SecurityReportsRoute /></MainSecurityPage> },
      { path: '/security/reports/:id', element: <MainSecurityPage><SecurityReportRoute /></MainSecurityPage> },
      // A sample report on a fictional contract, and the scan terms (also at /security/terms).
      { path: '/security/sample', element: <MainSecurityPage><SecuritySampleRoute /></MainSecurityPage> },
      { path: '/security/terms', element: <MainSecurityPage><Navigate to="/legal/scan-terms" replace /></MainSecurityPage> },
      // Public status: every check, 24 h of uptime and the incident history (GET /api/status).
      { path: '/status', lazy: () => import('./pages/Status').then((m) => ({ Component: m.StatusPage })) },
      // The link hub for bios and KOL posts.
      { path: '/links', element: <LinksRoute /> },
      // The Gully Score (src/pages/score): the public index and one page per contract.
      { path: '/score', lazy: () => import('./pages/score/ScoreIndex').then((m) => ({ Component: m.ScoreIndex })) },
      { path: '/score/:chain/:address', lazy: () => import('./pages/score/ScorePage').then((m) => ({ Component: m.ScorePage })) },
      // The Gully Pay merchant terms (the checkout's footer links here).
      { path: '/legal/merchant-terms', lazy: () => import('./pages/legal/MerchantTerms').then((m) => ({ Component: m.MerchantTermsPage })) },
      { path: '/legal/scan-terms', lazy: () => import('./pages/legal/ScanTerms').then((m) => ({ Component: m.ScanTermsPage })) },
      { path: '/legal/privacy', lazy: () => import('./pages/legal/Privacy').then((m) => ({ Component: m.PrivacyPage })) },
      { path: '/legal/terms', lazy: () => import('./pages/legal/Terms').then((m) => ({ Component: m.TermsPage })) },
      { path: '/terms', element: <Navigate to="/legal/terms" replace /> },
      { path: '/privacy', element: <Navigate to="/legal/privacy" replace /> },
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
  { path: '/embed/holders/:chain/:token', element: <HolderMapOpened from="embed"><EmbedHoldersRoute /></HolderMapOpened> },
  // Gully Pay's standalone checkout (src/pages/pay/CheckoutFrame): its own layout, no site header, nav or
  // footer. Never linked from the site, never indexed; whoever holds the link pays here.
  { element: <CheckoutRoot />, children: payChildren },
  // Development only: the docs site under /docs on the main host. In production it lives on its own host.
  { path: '/docs', children: docsRoutes },
]

// On the admin host every path is the dashboard; it has its own chrome (no site header or footer).
const adminRoutes = [{ path: '*', element: <AdminRoute /> }]

// On the app host the dashboard is the home page; every other page
// belongs to the main site, so it leaves for it with the same path.
// The app is full-screen: it draws its own sidebar and header, so no site Layout here.
const appRoutes = [
  { path: '/', element: <DevelopersRoute /> },
  { path: '*', element: <ToSite /> },
]

// pay. and embed. are single-purpose hosts (server/hosts.mjs sends everything else to the main site): only their own pages load here.
const payRoutes = [{ element: <CheckoutRoot />, children: payChildren }, { path: '*', element: <ToSite /> }]
const embedRoutes = [{ path: '/embed/holders/:chain/:token', element: <HolderMapOpened from="embed"><EmbedHoldersRoute /></HolderMapOpened> }, { path: '*', element: <ToSite /> }]

// holdermaps.xyz (server/hosts.mjs): the Holder Map at the root with short paths, in the site's own layout. Its header
// and footer link the rest of Gully Labs, which lives on gullylabs.xyz (ToSite, and src/lib/holderMapsLinks.ts).
const holderMapsRoutes = [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HmLandingRoute /> },
      { path: '/deep/:id', element: <HoldersDeepRoute /> },
      { path: '/:chain/:token', element: <HolderMapsTokenPage /> },
      { path: '/holders/*', element: <ToShortHolderPath /> },
      { path: '/holders', element: <ToShortHolderPath /> },
      // The server 301s every gullylabs.xyz page to gullylabs.xyz, so a path that reaches the app here is a 404.
      { path: '*', element: <HmNotFoundRoute /> },
    ],
  },
]

// gullysecurity.xyz (server/hosts.mjs): Gully Security at the root with short paths, in the site's own layout. Its
// header and footer link the rest of Gully Labs, which lives on gullylabs.xyz (ToSite, and src/lib/securityLinks.ts).
const securityRoutes = [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <SecurityRoute /> },
      { path: '/reports', element: <SecurityReportsRoute /> },
      { path: '/reports/:id', element: <SecurityReportRoute /> },
      { path: '/sample', element: <SecuritySampleRoute /> },
      { path: '/terms', lazy: () => import('./pages/legal/ScanTerms').then((m) => ({ Component: m.ScanTermsPage })) },
      { path: '/security/*', element: <ToShortSecurityPath /> },
      { path: '/security', element: <ToShortSecurityPath /> },
      { path: '*', element: <ToSite /> },
    ],
  },
]

const routes = isHolderMapsHost() ? holderMapsRoutes : isSecurityHost() ? securityRoutes : isPayHost() ? payRoutes : isEmbedHost() ? embedRoutes : isAdminHost() ? adminRoutes : isDocsHost() ? docsRoutes : isAppHost() ? appRoutes : mainRoutes

// One error boundary over every host's routes: a page left open across a deploy reloads onto the new
// build instead of showing React Router's default error screen.
export const router = createBrowserRouter([{ errorElement: <RouteError />, children: routes }])
