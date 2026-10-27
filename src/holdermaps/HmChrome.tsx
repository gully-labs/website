/* HolderMaps' top bar and footer on holdermaps.xyz, Gully Terminal style (2026-10-27): the kit lockup (HolderMaps
   brand kit, public/brand/holdermaps, height only, never stretched), the Gully products switcher, icon + label nav,
   one square primary button, and a Menu sheet below 1024 px. Every menu item has a Lucide icon; links to another
   origin (other Gully products included) open in a new tab. The footer carries the kit "Powered by Gully Labs" badge. */
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Activity, ArrowUpRight, BookOpen, Boxes, Code2, CreditCard, FileText, Flame, Gamepad2, LayoutGrid, Link2, Map as MapIcon, Menu, Plug, Radar, ScanSearch, Server, ShieldCheck, Sparkles, X, type LucideProps } from 'lucide-react'
import type { ComponentType } from 'react'
import './hm.css'

type Icon = ComponentType<LucideProps>
interface Item {
  label: string
  icon: Icon
  to?: string
  href?: string
}
const DOCS = 'https://docs.gullylabs.xyz'
const ic = (I: Icon, cls = 'hm-ic') => <I className={cls} aria-hidden focusable={false} />

const NAV: Item[] = [
  { label: 'Map a token', icon: ScanSearch, to: '/#map' },
  { label: 'Live', icon: Radar, to: '/#live' },
  { label: 'Chains', icon: Link2, to: '/#chains' },
  { label: 'Embed', icon: Plug, to: '/#build' },
  { label: 'API', icon: Code2, href: `${DOCS}/api#holders` },
  { label: 'Docs', icon: BookOpen, href: `${DOCS}/holder-map` },
]

/** Every Gully product, each on its own domain (the switcher and the footer list). */
const PRODUCTS: { name: string; sub: string; href: string; icon: Icon; self?: boolean }[] = [
  { name: 'HolderMaps', sub: 'Holder bubble maps', href: 'https://holdermaps.xyz', icon: MapIcon, self: true },
  { name: 'Gully Chain', sub: 'L3 chains, testnet 485590', href: 'https://gullychain.xyz', icon: Boxes },
  { name: 'Gully Pay', sub: 'Payments and checkout', href: 'https://gullypay.xyz', icon: CreditCard },
  { name: 'Gully RPC', sub: 'Node RPC gateway', href: 'https://gullyrpc.xyz', icon: Server },
  { name: 'Gully Security', sub: 'Scans and monitoring', href: 'https://gullysecurity.xyz', icon: ShieldCheck },
  { name: 'Gully Studio', sub: 'Game studio', href: 'https://gullystudio.xyz', icon: Gamepad2 },
  { name: 'Gully Labs', sub: 'The studio behind them', href: 'https://gullylabs.xyz', icon: Sparkles },
  { name: 'Status', sub: 'Every surface, live', href: 'https://gullylabs.xyz/status', icon: Activity },
]

function NavItem({ it, onClick }: { it: Item; onClick?: () => void }) {
  const body = (
    <>
      {ic(it.icon)}
      <span className="lbl">{it.label}</span>
      {it.href && ic(ArrowUpRight, 'hm-ic hm-ext')}
    </>
  )
  if (it.href)
    return (
      <a href={it.href} target="_blank" rel="noopener noreferrer" onClick={onClick}>
        {body}
        <span className="hm-sr"> (opens in a new tab)</span>
      </a>
    )
  return (
    <Link to={it.to ?? '/'} onClick={onClick}>
      {body}
    </Link>
  )
}

function Switcher() {
  return (
    <details className="hm-switch">
      <summary aria-label="Gully products">
        {ic(LayoutGrid)} Gully
      </summary>
      <div className="hm-switch-menu">
        {PRODUCTS.map((p) =>
          p.self ? (
            <Link key={p.name} to="/" aria-current="page">
              {ic(p.icon)}
              <b>{p.name}</b>
              <span>{p.sub}</span>
            </Link>
          ) : (
            <a key={p.name} href={p.href} target="_blank" rel="noopener noreferrer">
              {ic(p.icon)}
              <b>{p.name}</b>
              <span>
                {p.sub}
                <span className="hm-sr"> (opens in a new tab)</span>
              </span>
            </a>
          ),
        )}
        <span className="foot">Gully Labs products · one account, one payment gateway</span>
      </div>
    </details>
  )
}

export function HmHeader() {
  const { pathname } = useLocation()
  const [openOn, setOpenOn] = useState<string | null>(null)
  const open = openOn === pathname
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpenOn(null)
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [open])
  return (
    <>
      <header className="hm-nav">
        <div className="hm-wrap">
          <Link className="hm-brand" to="/" aria-label="HolderMaps home">
            {/* The kit PNG lockup: the kit SVG's globe <image> has no source, so the SVG renders without the emblem. */}
            <img src="/brand/holdermaps/holdermaps-logo-on-dark-sm.png" srcSet="/brand/holdermaps/holdermaps-logo-on-dark-sm.png 1x, /brand/holdermaps/holdermaps-logo-on-dark.png 2x" width={155} height={32} alt="HolderMaps" decoding="async" fetchPriority="high" />
          </Link>
          <Switcher />
          <nav aria-label="Main">
            <ul>
              {NAV.map((it) => (
                <li key={it.label}>
                  <NavItem it={it} />
                </li>
              ))}
            </ul>
          </nav>
          <div className="hm-navr">
            <Link className="hm-btn" to="/#map">
              {ic(ScanSearch)}
              <span className="lbl">Map a token</span>
            </Link>
            <button type="button" className="hm-menu" aria-expanded={open} aria-controls="hm-sheet" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpenOn(open ? null : pathname)}>
              {ic(open ? X : Menu)}
            </button>
          </div>
        </div>
      </header>
      {open && (
        <div id="hm-sheet" className="hm-sheet">
          <ul>
            {NAV.map((it) => (
              <li key={it.label}>
                <NavItem it={it} onClick={() => setOpenOn(null)} />
              </li>
            ))}
          </ul>
          <p className="hm-sheet-k">Gully products</p>
          <ul>
            {PRODUCTS.filter((p) => !p.self).map((p) => (
              <li key={p.name}>
                <NavItem it={{ label: p.name, icon: p.icon, href: p.href }} onClick={() => setOpenOn(null)} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

const COLS: [string, Item[]][] = [
  [
    'HolderMaps',
    [
      { label: 'Map a token', icon: ScanSearch, to: '/#map' },
      { label: 'Most scanned today', icon: Flame, to: '/#live' },
      { label: 'Chains we map', icon: Link2, to: '/#chains' },
      { label: 'Embed and widget', icon: Plug, to: '/#build' },
    ],
  ],
  [
    'Build',
    [
      { label: 'Docs', icon: BookOpen, href: `${DOCS}/holder-map` },
      { label: 'Embed a map', icon: Plug, href: `${DOCS}/holder-map-integrate` },
      { label: 'API', icon: Code2, href: `${DOCS}/api#holders` },
      { label: 'Status', icon: Activity, href: 'https://gullylabs.xyz/status' },
    ],
  ],
  [
    'Gully',
    [
      { label: 'Gully Labs', icon: Sparkles, href: 'https://gullylabs.xyz' },
      { label: 'Gully Chain', icon: Boxes, href: 'https://gullychain.xyz' },
      { label: 'Terms', icon: FileText, href: 'https://gullylabs.xyz/legal/terms' },
      { label: 'Privacy', icon: FileText, href: 'https://gullylabs.xyz/legal/privacy' },
    ],
  ],
]

export function HmFooter() {
  return (
    <footer className="hm-foot">
      <div className="hm-wrap">
        <div className="hm-foot-grid">
          <div className="hm-foot-about">
            <Link to="/" aria-label="HolderMaps home" className="hm-brand">
              <img src="/brand/holdermaps/holdermaps-wordmark-on-dark.svg" width={140} height={28} alt="HolderMaps" decoding="async" loading="lazy" />
            </Link>
            <p>Who really holds a token: bubble maps, linked wallets and launch health for any token on Gully Chain, Robinhood Chain, BNB Chain, Base, HyperEVM and Solana. Free, no sign-up.</p>
          </div>
          {COLS.map(([title, items]) => (
            <nav key={title} aria-label={title}>
              <h2>{title}</h2>
              <ul>
                {items.map((it) => (
                  <li key={it.label}>
                    <NavItem it={it} />
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="hm-foot-bottom">
          <p>© 2026 HolderMaps · every figure is read live from the chains; a source that cannot be read says so, never zero.</p>
          <a className="hm-badge" href="https://gullylabs.xyz" target="_blank" rel="noopener noreferrer" aria-label="Powered by Gully Labs (opens in a new tab)">
            <img src="/brand/badges/powered-by-gully-labs-dark.png" srcSet="/brand/badges/powered-by-gully-labs-dark.png 1x, /brand/badges/powered-by-gully-labs-dark-2x.png 2x, /brand/badges/powered-by-gully-labs-dark-3x.png 3x" width={127} height={32} alt="Powered by Gully Labs" decoding="async" loading="lazy" />
          </a>
        </div>
      </div>
    </footer>
  )
}
