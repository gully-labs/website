/* HolderMaps' own header and footer (holdermaps.xyz, 2026-10-26), from the HolderMaps brand kit
   (Desktop/GULLY LABS GRAPHICS/HolderMaps/brand-kit; files copied byte-exact to public/brand/holdermaps/):
   the kit lockup at 40 px (32 px on phones), height only, never stretched; ink #0A0A0A, carbon #161616, the
   yellow gradient on the primary button; one line from 1024 to 1920 px with a Menu sheet below. Every menu item
   has a Lucide icon; links to other origins open in a new tab (src/lib/externalLinks.ts). The footer carries the
   kit "Powered by Gully Labs" badge. */
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { ArrowUpRight, BookOpen, Code2, Flame, Menu, Plug, Radar, ScanSearch, X, type LucideProps } from 'lucide-react'
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
  { label: 'Live launches', icon: Radar, to: '/#launches' },
  { label: 'Most scanned', icon: Flame, to: '/#top' },
  { label: 'Embed', icon: Plug, href: `${DOCS}/holder-map-integrate` },
  { label: 'API', icon: Code2, href: `${DOCS}/api#holders` },
  { label: 'Docs', icon: BookOpen, href: `${DOCS}/holder-map` },
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
            <img src="/brand/holdermaps/holdermaps-logo-on-dark-sm.png" srcSet="/brand/holdermaps/holdermaps-logo-on-dark-sm.png 1x, /brand/holdermaps/holdermaps-logo-on-dark.png 2x" width={193} height={40} alt="HolderMaps" decoding="async" fetchPriority="high" />
          </Link>
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
        </div>
      )}
    </>
  )
}

const FOOT: Item[] = [
  { label: 'Docs', icon: BookOpen, href: `${DOCS}/holder-map` },
  { label: 'Embed a map', icon: Plug, href: `${DOCS}/holder-map-integrate` },
  { label: 'API', icon: Code2, href: `${DOCS}/api#holders` },
  { label: 'Status', icon: Radar, href: 'https://gullylabs.xyz/status' },
  { label: 'Terms', icon: BookOpen, href: 'https://gullylabs.xyz/legal/terms' },
  { label: 'Privacy', icon: BookOpen, href: 'https://gullylabs.xyz/legal/privacy' },
]

export function HmFooter() {
  return (
    <footer className="hm-foot">
      <div className="hm-wrap">
        <div className="hm-foot-top">
          <Link to="/" aria-label="HolderMaps home" className="hm-brand">
            <img src="/brand/holdermaps/holdermaps-wordmark-on-dark.svg" width={120} height={24} alt="HolderMaps" decoding="async" />
          </Link>
          <nav aria-label="Footer">
            <ul>
              {FOOT.map((it) => (
                <li key={it.label}>
                  <NavItem it={it} />
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="hm-foot-bottom">
          <p>© 2026 HolderMaps · Every figure is read live from the chains; a source that cannot be read says so, never zero.</p>
          <a className="hm-badge" href="https://gullylabs.xyz" target="_blank" rel="noopener noreferrer" aria-label="Powered by Gully Labs (opens in a new tab)">
            <img src="/brand/badges/powered-by-gully-labs-dark.png" srcSet="/brand/badges/powered-by-gully-labs-dark.png 1x, /brand/badges/powered-by-gully-labs-dark-2x.png 2x, /brand/badges/powered-by-gully-labs-dark-3x.png 3x" width={127} height={32} alt="Powered by Gully Labs" decoding="async" />
          </a>
        </div>
      </div>
    </footer>
  )
}
