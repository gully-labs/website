/* Site header and footer in the lab-console language: one line from 1024 to 1920 px (labels drop to icons
   below 1280), a Menu sheet below 1024, Lucide icon on every item, live pill, pill buttons. */
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Activity, ArrowRight, ArrowUpRight, BookOpen, Box, Briefcase, ChartCandlestick, ChartLine, FileText, Gauge, KeyRound, LayoutGrid, Lock, Mail, Menu, MessageCircle, Send, Sparkles, Tag, type LucideProps, X, Zap } from 'lucide-react'
import type { ComponentType } from 'react'
import { APP_URL, DOCS_URL } from '../site-host'
import { ic, LivePill } from './ui'
import { PRODUCTS } from '../terminal/catalog'
import { PRODUCT_ICON } from './productIcons'

type Icon = ComponentType<LucideProps>
const BLOG_URL = 'https://blog.gullylabs.xyz'
interface Item {
  label: string
  icon: Icon
  to?: string
  href?: string
}

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

const headerItems = (home: boolean): Item[] => [
  { label: 'Products', icon: LayoutGrid, to: '/products' },
  { label: 'Services', icon: Briefcase, to: '/services' },
  { label: 'Live', icon: ChartLine, to: '/#live' },
  { label: 'Docs', icon: BookOpen, href: DOCS_URL },
  { label: 'Blog', icon: MessageCircle, href: BLOG_URL },
  { label: 'Contact', icon: Mail, to: home ? '/#contact' : '/services#contact' },
]
// Gully Labs' own pages. The products live on their own domains (the Products list below, and /products).
const pages: Item[] = [
  { label: 'All products', icon: LayoutGrid, to: '/products' },
  { label: 'Tracker', icon: ChartCandlestick, to: '/tracker' },
  { label: 'Gully Score', icon: Gauge, to: '/score' },
  { label: 'Pricing', icon: Tag, to: '/pricing' },
  { label: 'Gully AI', icon: Sparkles, to: '/ask' },
  { label: 'Status', icon: Activity, to: '/status' },
]

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
          <img src="/brand/icon/gully-labs-icon.png" width={30} height={33} alt="" />
          <img src="/brand/logo/gully-labs-wordmark-horizontal.png" width={170} height={17} alt="Gully Labs" />
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
  const links: Item[] = [
    { label: 'Docs', icon: BookOpen, href: DOCS_URL },
    { label: 'App', icon: Zap, href: APP_URL },
    { label: 'Status', icon: Activity, to: '/status' },
    { label: 'X', icon: ArrowUpRight, href: 'https://x.com/Gully_Labs' },
    { label: 'Telegram', icon: Send, href: 'https://t.me/GullyLabsNews' },
    { label: 'GitHub', icon: Box, href: 'https://github.com/gully-labs' },
  ]
  const more: Item[] = [
    { label: 'Products', icon: LayoutGrid, to: '/products' },
    { label: 'Services', icon: Briefcase, to: '/services' },
    { label: 'Tracker', icon: ChartCandlestick, to: '/tracker' },
    { label: 'Gully Score', icon: Gauge, to: '/score' },
    { label: 'Pricing', icon: Tag, to: '/pricing' },
    { label: 'Gully AI', icon: Sparkles, to: '/ask' },
    { label: 'Terms', icon: FileText, to: '/legal/terms' },
    { label: 'Privacy', icon: Lock, to: '/legal/privacy' },
    { label: 'Gully ID sign-in', icon: KeyRound, to: '/gully-id' },
  ]
  return (
    <footer>
      <div className="wrap">
        <div>
          <img src="/brand/logo/gully-labs-logo.png" srcSet="/brand/logo/gully-labs-logo.png 1x, /brand/logo/gully-labs-logo-2x.png 2x" width={160} height={64} alt="Gully Labs — You Think It, We Ship It." />
          <span className="tagline">You Think It, We Ship It. · Web3 product studio and development services</span>
          <a className="gt-badge" href="/" aria-label="Powered by Gully Labs">
            <img src="/brand/badges/powered-by-gully-labs-dark.png" srcSet="/brand/badges/powered-by-gully-labs-dark.png 1x, /brand/badges/powered-by-gully-labs-dark-2x.png 2x, /brand/badges/powered-by-gully-labs-dark-3x.png 3x" width={190} height={48} alt="Powered by Gully Labs" />
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
        <p className="copy2">
          © 2026 Gully Labs · Figures are read live from each product's own API and the Gully Chain testnet; a venue that cannot be read is shown as unreadable, never as zero.
        </p>
      </div>
    </footer>
  )
}
