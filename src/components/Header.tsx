import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUpRight, Menu, X } from 'lucide-react'
import { navItems } from '../content/site'
import { useContact } from './ContactContext'
import { Wordmark } from './Wordmark'
import { btnGold } from './ui'

const WIDE_QUERY = '(min-width: 860px)'

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

        <nav aria-label="Main" className="hidden items-center gap-8 min-[860px]:flex">
          {navItems.map((n) => (
            <Link
              key={n.label}
              to={n.to}
              aria-current={isActive(n.match) ? 'page' : undefined}
              className={`group inline-flex items-center gap-2 border-b-2 py-[6px] text-[15px] transition-colors hover:text-ink ${
                isActive(n.match) ? 'border-gold text-ink' : 'border-transparent text-muted'
              }`}
            >
              <n.icon
                aria-hidden
                size={16}
                strokeWidth={1.75}
                className={`transition-colors ${isActive(n.match) ? 'text-gold' : 'text-faint group-hover:text-gold'}`}
              />
              {n.label}
            </Link>
          ))}
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

      <AnimatePresence initial={false}>
        {menuOpen && (
          <motion.nav
            id="mobile-menu"
            aria-label="Mobile"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden min-[860px]:hidden"
          >
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
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  )
}
