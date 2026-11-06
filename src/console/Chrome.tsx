/* Site header and footer in the lab-console language: one line from 1024 to 1920 px (labels drop to icons
   below 1280), a Menu sheet below 1024, Lucide icon on every item, live pill, pill buttons. */
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Activity, ArrowLeftRight, ArrowRight, ArrowUpRight, BookOpen, Box, Briefcase, ChartCandlestick, ChartLine, FileText, Gauge, KeyRound, LayoutGrid, Lock, Mail, Menu, MessageCircle, Rocket, Scale, Send, Sparkles, Tag, Trophy, type LucideProps, X, Zap } from 'lucide-react'
import type { ComponentType } from 'react'
import { APP_URL } from '../site-host'
import { FOOTER_COPY, FOOTER_LEGAL, FOOTER_LINKS, FOOTER_MORE, FOOTER_TAGLINE, headerNav, PAGES_NAV, type NavLinkDef } from '../content/nav'
import { ic, LivePill } from './ui'
import { PRODUCTS } from '../terminal/catalog'
import { PRODUCT_ICON } from './productIcons'
import { PEDDLE_FAMILY, type PeddleKey } from '../pages/hub/hubData'

type Icon = ComponentType<LucideProps>
const PEDDLE_ICON: Record<PeddleKey, Icon> = { peddleswap: ArrowLeftRight, peddles: Rocket, peddlequest: Trophy }
interface Item {
  label: string
  icon: Icon
  to?: string
  href?: string
}

const PEDDLE_LINKS: Item[] = PEDDLE_FAMILY.map((p) => ({ label: p.name, icon: PEDDLE_ICON[p.key], href: p.url }))

function NavLink({ it, className, onClick }: { it: Item; className?: string; onClick?: () => void }) {
  const { pathname, hash } = useLocation()
  const body = (
    <>
      {ic(it.icon)}
      <span className="lbl">{it.label}</span>
    </>
  )
  if (it.href)
    return (
      <a className={className} href={it.href} target="_blank" rel="noopener noreferrer" onClick={onClick}>
        {body}
      </a>
    )
  const [path, h] = (it.to ?? '/').split('#')
  const current = path === pathname && (!h || `#${h}` === hash) && !(path === '/' && !h)
  return (
    <Link className={className} to={it.to ?? '/'} aria-current={current ? 'page' : undefined} onClick={onClick}>
      {body}
    </Link>
  )
}

/* The links themselves live in src/content/nav.ts (the server's pre-render reads the same lists); this file gives
   each one its icon, by label (a label not listed here gets the grid icon). */
const NAV_ICON = {
  Products: LayoutGrid,
  Services: Briefcase,
  Live: ChartLine,
  Docs: BookOpen,
  Blog: MessageCircle,
  Contact: Mail,
  'All products': LayoutGrid,
  Tracker: ChartCandlestick,
  'Gully Score': Gauge,
  Pricing: Tag,
  'Gully AI': Sparkles,
  Status: Activity,
  App: Zap,
  X: ArrowUpRight,
  Telegram: Send,
  GitHub: Box,
  'Gully ID sign-in': KeyRound,
  Terms: FileText,
  Privacy: Lock,
  Legal: Scale,
} satisfies Record<string, Icon>
const withIcons = (defs: NavLinkDef[]): Item[] => defs.map((d) => ({ ...d, icon: NAV_ICON[d.label as keyof typeof NAV_ICON] ?? LayoutGrid }))
const headerItems = (home: boolean): Item[] => withIcons(headerNav(home))
// Gully Labs' own pages. The products live on their own domains (the Products list below, and /products).
const pages: Item[] = withIcons(PAGES_NAV)

export function ConsoleHeader() {
  const { pathname } = useLocation()
  const home = pathname === '/'
  // The sheet belongs to the page it was opened on: navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null)
  const open = openOn === pathname
  const setOpen = (v: boolean) => setOpenOn(v ? pathname : null)
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [open])
  const items = headerItems(home)
  return (
    <>
    <header className="nav">
      <div className="wrap">
        <Link className="brand" to="/" aria-label="Gully Labs home">
          <img src="/brand/kit/logotype-reversed.svg" width={176} height={32} alt="Gully Labs" />
        </Link>
        <nav aria-label="Main">
          <ul>
            {items.map((it) => (
              <li key={it.label}>
                <NavLink it={it} />
              </li>
            ))}
          </ul>
        </nav>
        <div className="navr">
          <LivePill />
          <a className="btn sec sm" href={APP_URL} target="_blank" rel="noopener noreferrer" aria-label="Launch app">
            {ic(Zap)}
            <span className="lbl">Launch app</span>
          </a>
          <Link className="btn pri sm" to={home ? '/#contact' : '/services#contact'} aria-label="Start a project">
            <span className="lbl">Start a project</span>
            {ic(ArrowRight)}
          </Link>
          <button type="button" className="btn ter sm menu-btn" aria-expanded={open} aria-controls="lc-sheet" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(!open)}>
            {ic(open ? X : Menu)}
          </button>
        </div>
      </div>
    </header>
      {open && <ConsoleSheet home={home} close={() => setOpen(false)} />}
    </>
  )
}

/** The Menu sheet below 1024 px: the header's items, Gully Labs' pages, then every product with its own icon. */
export function ConsoleSheet({ home, close }: { home: boolean; close: () => void }) {
  const { pathname } = useLocation()
  return (
    <div id="lc-sheet" className="sheet">
      <div className="wrap">
        <ul className="sheet-list">
          {[...headerItems(home), ...pages].map((it) => (
            <li key={`${it.label}${it.to ?? it.href}`}>
              <NavLink it={it} onClick={close} />
            </li>
          ))}
        </ul>
        <span className="lab">Products</span>
        <ul className="sheet-list">
          {PRODUCTS.map((p) => (
            <li key={p.slug}>
              <Link to={`/products/${p.slug}`} aria-current={pathname === `/products/${p.slug}` ? 'page' : undefined} onClick={close}>
                {ic(PRODUCT_ICON[p.slug])}
                <span className="lbl">{p.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function ConsoleFooter() {
  const home = useLocation().pathname === '/'
  const links = withIcons(FOOTER_LINKS)
  const more = withIcons(FOOTER_MORE)
  const legal = withIcons(FOOTER_LEGAL)
  return (
    <footer>
      <div className="wrap">
        <div>
          <img src="/brand/kit/wordmark-reversed.svg" width={200} height={56} alt="Gully Labs, Web3 and DeFi development" loading="lazy" />
          <span className="tagline">{FOOTER_TAGLINE}</span>
          <a className="gt-badge" href="/" aria-label="Powered by Gully Labs">
            <img src="/brand/kit/powered-by-clear-white.svg" width={160} height={48} alt="Powered by Gully Labs" loading="lazy" />
          </a>
        </div>
        <nav aria-label="Footer">
          <ul>
            {links.map((it) => (
              <li key={it.label}>
                <NavLink it={it} />
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Gully products" className="fprods">
          {(
            [
              ['labs', 'Gully Labs'],
              ['chain', 'Gully Chain'],
            ] as const
          ).map(([g, label]) => (
            <div className="fgrp" key={g}>
              <span className="lab">{label}</span>
              <ul>
                {PRODUCTS.filter((p) => p.group === g).map((p) => (
                  <li key={p.slug}>
                    <Link to={`/products/${p.slug}`}>
                      {ic(PRODUCT_ICON[p.slug])}
                      <span className="lbl">{p.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {/* The Peddle family: Gully Labs projects on their own sites (owner, 2026-11-05). New tab, like every other host. */}
          <div className="fgrp" data-testid="footer-peddle">
            <span className="lab">Peddle</span>
            <ul>
              {PEDDLE_LINKS.map((it) => (
                <li key={it.label}>
                  <NavLink it={it} />
                </li>
              ))}
            </ul>
          </div>
        </nav>
        {!home && (
          <nav aria-label="Site pages" className="more">
            <ul>
              {more.map((it) => (
                <li key={it.label}>
                  <NavLink it={it} />
                </li>
              ))}
            </ul>
          </nav>
        )}
        <nav aria-label="Legal" className="legal" data-testid="footer-legal">
          <ul>
            {legal.map((it) => (
              <li key={it.label}>
                <NavLink it={it} />
              </li>
            ))}
          </ul>
        </nav>
        <p className="copy2">{FOOTER_COPY}</p>
      </div>
    </footer>
  )
}
