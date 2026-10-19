/* Every lazily loaded page's chunk, in one place: LazyRoutes renders them, and prefetchPath() starts
   fetching a page's chunk when a visitor shows intent (pointer over or focus on a link to it), so the
   page is usually in the cache before the click and the route skeleton barely shows. */

export const chunks = {
  tracker: () => import('./Tracker'),
  stock: () => import('./StockPage'),
  holders: () => import('./HoldersPage'),
  holdersLanding: () => import('./HoldersLanding'),
  holdersDeep: () => import('./HoldersDeepPage'),
  embedHolders: () => import('./EmbedHolders'),
  widget: () => import('./widget/WidgetPage'),
  developers: () => import('./developers/DevelopersPage'),
  services: () => import('./Services'),
  about: () => import('./About'),
  project: () => import('./ProjectDetail'),
  pricing: () => import('./Pricing'),
  chains: () => import('./Chains'),
  products: () => import('./Products'),
  ask: () => import('./ask/AskPage'),
  security: () => import('./security/SecurityPage'),
  securityReports: () => import('./security/ReportPages'),
  notFound: () => import('./NotFound'),
  links: () => import('./Links'),
  admin: () => import('./admin/AdminPage'),
  pay: () => import('./pay/PayPage'),
  receipt: () => import('./pay/Receipt'),
  payLink: () => import('./pay/LinkPage'),
  // The Telegram Mini App (/tg): its own chunk, never prefetched from the site.
  tg: () => import('./tg/TgApp'),
}

type Chunk = keyof typeof chunks

/** The chunk a main-site path renders, or null for the landing (already loaded) and unknown paths. */
function chunkFor(path: string): Chunk | null {
  if (path === '/tracker') return 'tracker'
  if (/^\/tracker\/[^/]+\/[^/]+$/.test(path)) return 'stock'
  if (/^\/holders\/deep\/[^/]+$/.test(path)) return 'holdersDeep'
  if (/^\/holders\/[^/]+\/[^/]+$/.test(path)) return 'holders'
  if (path === '/holders') return 'holdersLanding'
  if (path.startsWith('/projects/')) return 'project'
  if (path === '/analytics' || path === '/chain-kit') return 'products'
  if (path === '/chains') return 'chains'
  if (path === '/security') return 'security'
  if (path.startsWith('/security/reports')) return 'securityReports'
  const named: Record<string, Chunk> = { '/widget': 'widget', '/services': 'services', '/about': 'about', '/pricing': 'pricing', '/ask': 'ask', '/app': 'developers', '/developers': 'developers', '/links': 'links' }
  return named[path] ?? null
}

const started = new Set<Chunk>()

/** Starts loading the chunk behind a path (once); errors are left for the real navigation to handle. */
export function prefetchPath(path: string) {
  const c = chunkFor(path.replace(/\/+$/, '') || '/')
  if (!c || started.has(c)) return
  started.add(c)
  chunks[c]().catch(() => started.delete(c))
}
