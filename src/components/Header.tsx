import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { ArrowUpRight, Menu, X } from 'lucide-react'
import { headerDevItems, navItems } from '../content/site'
import { isDevelopersHost } from '../site-host'
import { useContact } from './ContactContext'
import { Wordmark } from './Wordmark'
import { btnGold } from './ui'

const WIDE_QUERY = '(min-width: 860px)'
const deskItem = 'group inline-flex items-center gap-2 border-b-2 py-[6px] text-[15px] transition-colors hover:text-ink'
// Between 860 and 1320 px the labels give way and the icons carry the menu (each keeps its title and name).
// Measured: with labels the bar needs ~1300 px, so labels at 1240 wrapped the header onto two lines.
const deskLabel = 'sr-only min-[1320px]:not-sr-only'

export function Header() {
  const { pathname } = useLocation()
  const { openContact } = useContact()
  const [menuOpen, setMenuOpen] = useState(false)

  // Close the mobile menu when the viewport widens or on Escape.
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY)
    const onChange = () => mq.matches && setMenuOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    mq.addEventListener('change', onChange)
    window.addEventListener('keydown', onKey)
    return () => {
      mq.removeEventListener('change', onChange)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const isActive = (match: string) => pathname.startsWith(match)
  const close = () => setMenuOpen(false)

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-[rgba(11,14,19,.86)] backdrop-blur-[10px]">
      <div className="flex items-center justify-between gap-5 px-page py-[18px]">
        <Link to="/" onClick={close} className="text-ink" aria-label="Gully Labs home">
          <Wordmark size={30} shimmer />
        </Link>

        <nav aria-label="Main" className="hidden flex-nowrap items-center gap-4 whitespace-nowrap min-[860px]:flex min-[1100px]:gap-5 min-[1480px]:gap-7">
          {navItems.map((n) => (
            <Link
              key={n.label}
              to={n.to}
              title={n.label}
              aria-current={isActive(n.match) ? 'page' : undefined}
              className={`${deskItem} ${isActive(n.match) ? 'border-gold text-ink' : 'border-transparent text-muted'}`}
            >
              <n.icon aria-hidden size={16} strokeWidth={1.75} className={`transition-colors ${isActive(n.match) ? 'text-gold' : 'text-faint group-hover:text-gold'}`} />
              <span className={deskLabel}>{n.label}</span>
            </Link>
          ))}
          <span aria-hidden className="h-5 w-px bg-line-strong" />
          {headerDevItems.map((n) => {
            const active = !!n.match && (isActive(n.match) || (n.match === '/developers' && isDevelopersHost()))
            const cls = `${deskItem} ${active ? 'border-gold text-ink' : 'border-transparent text-muted'}`
            const inner = (
              <>
                <n.icon aria-hidden size={16} strokeWidth={1.75} className={`transition-colors ${active ? 'text-gold' : 'text-faint group-hover:text-gold'}`} />
                <span className={deskLabel}>{n.label}</span>
              </>
            )
            return n.href ? (
              <a key={n.label} href={n.href} title={n.label} className={cls}>
                {inner}
              </a>
            ) : (
              <Link key={n.label} to={n.to!} title={n.label} aria-current={active ? 'page' : undefined} className={cls}>
                {inner}
              </Link>
            )
          })}
          <button type="button" onClick={() => openContact()} className={`${btnGold} inline-flex items-center gap-2 px-[22px] py-3 text-[15px]`}>
            Start a project
            <ArrowUpRight aria-hidden size={16} strokeWidth={2} />
          </button>
        </nav>

        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          className="inline-flex min-h-11 items-center gap-2 rounded-btn border border-line-strong bg-transparent px-4 py-[10px] font-mono text-[13px] text-ink min-[860px]:hidden"
        >
          {menuOpen ? <X aria-hidden size={16} /> : <Menu aria-hidden size={16} />}
          {menuOpen ? 'Close' : 'Menu'}
        </button>
      </div>

      {/* Height animates with a CSS grid-row transition (0fr to 1fr); closed, the menu is inert. */}
      <nav
        id="mobile-menu"
        aria-label="Mobile"
        inert={!menuOpen}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out min-[860px]:hidden ${menuOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
      >
        {/* On a short screen (a phone held sideways) the open menu scrolls instead of running off the bottom. */}
        <div className="max-h-[calc(100dvh-82px)] overflow-hidden overscroll-contain" style={menuOpen ? { overflowY: 'auto' } : undefined}>
            <div className="flex flex-col border-t border-line px-page pt-2 pb-6">
              {navItems.map((n) => (
                <Link
                  key={n.label}
                  to={n.to}
                  onClick={close}
                  aria-current={isActive(n.match) ? 'page' : undefined}
                  className={`flex items-center gap-4 border-b border-line py-[18px] text-left font-display text-[28px] font-bold uppercase ${
                    isActive(n.match) ? 'text-ink' : 'text-muted'
                  }`}
                >
                  <n.icon
                    aria-hidden
                    size={24}
                    strokeWidth={1.75}
                    className={isActive(n.match) ? 'text-gold' : 'text-faint'}
                  />
                  {n.label}
                </Link>
              ))}
              <div className="mt-2 grid grid-cols-3 gap-2 pt-4">
                {headerDevItems.map((n) => {
                  const cls = 'flex min-h-[68px] flex-col items-center justify-center gap-2 rounded-btn border border-line-strong px-2 font-mono text-[13px] text-ink-2 transition-colors hover:border-gold hover:text-ink'
                  const inner = (
                    <>
                      <n.icon aria-hidden size={18} strokeWidth={1.75} className="text-gold" />
                      {n.label}
                    </>
                  )
                  return n.href ? (
                    <a key={n.label} href={n.href} onClick={close} className={cls}>
                      {inner}
                    </a>
                  ) : (
                    <Link key={n.label} to={n.to!} onClick={close} className={cls}>
                      {inner}
                    </Link>
                  )
                })}
              </div>
              <button
                type="button"
                onClick={() => {
                  close()
                  openContact()
                }}
                className={`${btnGold} mt-5 inline-flex items-center justify-center gap-2 p-4 text-[16px]`}
              >
                Start a project
                <ArrowUpRight aria-hidden size={18} strokeWidth={2} />
              </button>
            </div>
        </div>
      </nav>
    </header>
  )
}
