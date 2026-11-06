/* The site header's and footer's links (src/console/Chrome.tsx draws them, with an icon each). Plain data with no
   imports, so scripts/build-page-content.mjs can read the same lists for the page a crawler is served: the header,
   the footer and its product list are then the same links before and after scripts run. */

export interface NavLinkDef {
  label: string
  /** A page of this site, or … */
  to?: string
  /** … another site (opens in a new tab). */
  href?: string
}

export const NAV_DOCS_URL = 'https://docs.gullylabs.xyz'
export const NAV_APP_URL = 'https://app.gullylabs.xyz'
export const NAV_BLOG_URL = 'https://blog.gullylabs.xyz'

/** The header. "Contact" opens the form on the page that has one: the home page's, else the Services page's. */
export const headerNav = (home: boolean): NavLinkDef[] => [
  { label: 'Products', to: '/products' },
  { label: 'Services', to: '/services' },
  { label: 'Live', to: '/#live' },
  { label: 'Docs', href: NAV_DOCS_URL },
  { label: 'Blog', href: NAV_BLOG_URL },
  { label: 'Contact', to: home ? '/#contact' : '/services#contact' },
]

/** Gully Labs' own pages (the Menu sheet lists them under the header's items). */
export const PAGES_NAV: NavLinkDef[] = [
  { label: 'All products', to: '/products' },
  { label: 'Tracker', to: '/tracker' },
  { label: 'Gully Score', to: '/score' },
  { label: 'Pricing', to: '/pricing' },
  { label: 'Gully AI', to: '/ask' },
  { label: 'Status', to: '/status' },
]

export const FOOTER_LINKS: NavLinkDef[] = [
  { label: 'Products', to: '/products' },
  { label: 'Docs', href: NAV_DOCS_URL },
  { label: 'App', href: NAV_APP_URL },
  { label: 'Status', to: '/status' },
  { label: 'X', href: 'https://x.com/Gully_Labs' },
  { label: 'Telegram', href: 'https://t.me/GullyLabsNews' },
  { label: 'GitHub', href: 'https://github.com/gully-labs' },
]

/** The footer's second row, on every page but the home page (which links these in its own sections). */
export const FOOTER_MORE: NavLinkDef[] = [
  { label: 'Products', to: '/products' },
  { label: 'Services', to: '/services' },
  { label: 'Tracker', to: '/tracker' },
  { label: 'Gully Score', to: '/score' },
  { label: 'Pricing', to: '/pricing' },
  { label: 'Gully AI', to: '/ask' },
  { label: 'Gully ID sign-in', to: '/gully-id' },
]

/** Every page: the Terms, the Privacy Policy and the index of every Gully product's (2026-11-03). */
export const FOOTER_LEGAL: NavLinkDef[] = [
  { label: 'Terms', to: '/terms' },
  { label: 'Privacy', to: '/privacy' },
  { label: 'Legal', to: '/legal' },
]

export const FOOTER_TAGLINE = 'You Think It, We Ship It. · Web3 product studio and development services'
export const FOOTER_COPY = '© 2026 Gully Labs LLC · Figures are read live from each product and the Gully Chain testnet; a source that cannot be read says so.'
