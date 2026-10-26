/* holdermaps.xyz's own header and footer: HolderMaps is its own app (owner, 2026-10-26), so its chrome carries the
   HolderMaps kit logo and its own pages, and Gully Labs shrinks to a small "by Gully Labs" link and the kit's
   "Powered by Gully Labs" badge in the footer. Same lab-console language as the site's (Chrome.tsx): one line from
   1024 to 1920 px (labels drop to icons below 1280), a Menu sheet below 1024, a Lucide icon on every item, a live
   pill, pill buttons. Colours come from [data-product-brand='holdermaps'] (src/index.css). */
import { useEffect, useState, type ComponentType } from 'react'
import { Link, useLocation } from 'react-router'
import { Activity, BookOpen, Code, Flame, Info, Menu, Radar, Search, Send, Sparkles, X, type LucideProps } from 'lucide-react'
import { PRODUCT_BRANDS } from '../brand/products'
import type { CheckedLaunches } from '../lib/holders'
import { DOCS_URL, SITE_URL } from '../site-host'
import { Arrow, ic } from './ui'
import { fmtTime } from './charts'

type Icon = ComponentType<LucideProps>
interface Item {
  label: string
  icon: Icon
  to?: string
  href?: string
}

const HM = PRODUCT_BRANDS.holdermaps
const NEW_TAB = <span className="sr"> (opens in a new tab)</span>

/** HolderMaps' own pages (sections of its home) and its docs. */
const HOLDERMAPS_NAV: Item[] = [
  { label: 'Map a token', icon: Search, to: '/#map-a-token' },
  { label: 'New launches', icon: Radar, to: '/#hl-feed' },
  { label: 'Most scanned', icon: Flame, to: '/#hl-top' },
  { label: 'How it works', icon: Info, to: '/#hl-how' },
  { label: 'Docs', icon: BookOpen, href: `${DOCS_URL}/holder-map` },
  { label: 'Embed', icon: Code, href: `${DOCS_URL}/holder-map-integrate` },
]

function NavItem({ it, onClick }: { it: Item; onClick?: () => void }) {
  const { pathname, hash } = useLocation()
  const body = (
    <>
      {ic(it.icon)}
      <span className="lbl">{it.label}</span>
    </>
  )
  if (it.href)
    return (
      <a href={it.href} target="_blank" rel="noopener noreferrer" onClick={onClick}>
        {body}
        {NEW_TAB}
      </a>
    )
  const [path, h] = (it.to ?? '/').split('#')
  const current = path === pathname && !!h && `#${h}` === hash
  return (
    <Link to={it.to ?? '/'} aria-current={current ? 'location' : undefined} onClick={onClick}>
      {body}
    </Link>
  )
}

/** The newest-launch feed's own clock (GET /api/holders/launches, every 30 s): HolderMaps' live state, not the site's. */
function HolderMapsLivePill() {
  const [s, setS] = useState<{ k: 'loading' } | { k: 'ok'; at: string | null } | { k: 'error' }>({ k: 'loading' })
  useEffect(() => {
    let alive = true
    const read = () =>
      fetch('/api/holders/launches', { headers: { accept: 'application/json' } })
        .then((r) => (r.ok ? (r.json() as Promise<CheckedLaunches>) : Promise.reject(new Error(String(r.status)))))
        .then((d) => {
          if (alive) setS({ k: 'ok', at: d.asOf })
        })
        .catch(() => {
          if (alive) setS((p) => (p.k === 'ok' ? p : { k: 'error' }))
        })
    read()
    const id = setInterval(read, 30_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  const down = s.k === 'error'
  return (
    <span className={`pill ${down ? 'down' : 'live'}`} data-testid="hm-live">
      <span className="dot" />
      <span>{down ? 'Feed unreadable' : s.k === 'ok' ? `Live · ${s.at ? fmtTime(s.at) : 'now'}` : 'Connecting'}</span>
    </span>
  )
}

/** The kit logo (feathered into its own backdrop colour). */
function Logo({ height = 30 }: { height?: number }) {
  return (
    <img
      src={HM.logo.src}
      srcSet={`${HM.logo.src} 1x, ${HM.logo.src2x} 2x`}
      width={Math.round((height * HM.logo.w) / HM.logo.h)}
      height={height}
      alt="HolderMaps"
      decoding="async"
      draggable={false}
    />
  )
}

export function HolderMapsHeader() {
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
      <header className="nav hm-nav" data-testid="hm-header">
        <div className="wrap">
          <Link className="brand" to="/" aria-label="HolderMaps home">
            <Logo />
          </Link>
          <nav aria-label="Main">
            <ul>
              {HOLDERMAPS_NAV.map((it) => (
                <li key={it.label}>
                  <NavItem it={it} />
                </li>
              ))}
            </ul>
          </nav>
          <div className="navr">
            <HolderMapsLivePill />
            <a className="by-gully" href={SITE_URL} target="_blank" rel="noopener noreferrer">
              by Gully Labs{NEW_TAB}
            </a>
            <Link className="btn pri sm" to="/#map-a-token" aria-label="Map a token">
              {ic(Search)}
              <span className="lbl">Map a token</span>
              <Arrow />
            </Link>
            <button type="button" className="btn ter sm menu-btn" aria-expanded={open} aria-controls="hm-sheet" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpenOn(open ? null : pathname)}>
              {ic(open ? X : Menu)}
            </button>
          </div>
        </div>
      </header>
      {open && (
        <div id="hm-sheet" className="sheet">
          <div className="wrap">
            <ul className="sheet-list">
              {HOLDERMAPS_NAV.map((it) => (
                <li key={it.label}>
                  <NavItem it={it} onClick={() => setOpenOn(null)} />
                </li>
              ))}
            </ul>
            <span className="lab">By Gully Labs</span>
            <ul className="sheet-list">
              <li>
                <a href={SITE_URL} target="_blank" rel="noopener noreferrer" onClick={() => setOpenOn(null)}>
                  <img src="/brand/icon/gully-labs-icon.png" width={18} height={20} alt="" />
                  <span className="lbl">Gully Labs</span>
                  {NEW_TAB}
                </a>
              </li>
            </ul>
          </div>
        </div>
      )}
    </>
  )
}

/** The kit's "Powered by Gully Labs" badge (dark), byte-exact files, at its own 254 x 64 ratio. */
export function PoweredByGullyLabs() {
  return (
    <a className="powered" href={SITE_URL} target="_blank" rel="noopener noreferrer" data-testid="powered-by">
      <picture>
        <source type="image/svg+xml" srcSet="/brand/badges/powered-by-gully-labs-dark.svg" />
        <img
          src="/brand/badges/powered-by-gully-labs-dark.png"
          srcSet="/brand/badges/powered-by-gully-labs-dark.png 1x, /brand/badges/powered-by-gully-labs-dark-2x.png 2x, /brand/badges/powered-by-gully-labs-dark-3x.png 3x"
          width={119}
          height={30}
          alt="Powered by Gully Labs"
        />
      </picture>
      {NEW_TAB}
    </a>
  )
}

export function HolderMapsFooter() {
  const more: Item[] = [
    { label: 'Gully AI', icon: Sparkles, href: `${SITE_URL}/ask` },
    { label: 'Status', icon: Activity, href: `${SITE_URL}/status` },
    { label: 'Telegram', icon: Send, href: 'https://t.me/GullyLabsNews' },
  ]
  return (
    <footer className="hm-foot" data-testid="hm-footer">
      <div className="wrap">
        <div>
          <Link to="/" aria-label="HolderMaps home">
            <Logo height={34} />
          </Link>
          <span className="tagline">Who really holds a token? Bubble maps, clusters and launch checks, read live.</span>
        </div>
        <nav aria-label="HolderMaps">
          <ul>
            {[...HOLDERMAPS_NAV, ...more].map((it) => (
              <li key={it.label}>
                <NavItem it={it} />
              </li>
            ))}
          </ul>
        </nav>
        <div className="hm-bottom">
          <p className="copy2">
            © 2026 HolderMaps, a Gully Labs product · Information only, not investment advice; holder data is read live and can be late or wrong ·{' '}
            <a href={`${SITE_URL}/legal/terms`} target="_blank" rel="noopener noreferrer">
              Terms{NEW_TAB}
            </a>{' '}
            ·{' '}
            <a href={`${SITE_URL}/legal/privacy`} target="_blank" rel="noopener noreferrer">
              Privacy{NEW_TAB}
            </a>
          </p>
          <PoweredByGullyLabs />
        </div>
      </div>
    </footer>
  )
}
