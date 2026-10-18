import { useCallback, useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router'
import * as NavigationMenu from '@radix-ui/react-navigation-menu'
import { AppWindow, ChevronDown, Menu, Send, X } from 'lucide-react'
import { launchApp, navGroups, navLinks, socialLinks, type NavEntry, type NavGroup } from '../content/site'
import { EntryLink, NewTabMark } from './LayoutLinks'
import { entryActive, groupActive, newTab } from './LayoutNav'
import { SocialIcon } from './SocialIcon'
import { Wordmark } from './Wordmark'
import { btnGold } from './ui'
import { useContact } from './ContactContext'
import './Layout.css'

/* The site header: logo, three grouped menus (Products, App & API, Company) with three plain links (Projects, Pricing, Gully AI)
   between them, and a "Launch app" split button. One line from 1024 px up; below that, a Menu button
   opens a full-height sheet with the same groups as accordions.

   Menus are Radix NavigationMenu: a <nav> with disclosure buttons (not role="menu"), opened by hover,
   click, Enter, Space or ArrowDown; Tab walks into the open panel, arrow keys move between items,
   Escape closes and returns focus to the trigger. */

const WIDE_QUERY = '(min-width: 1024px)'

/**
 * Controlled menu value with one fix: Radix opens a menu on hover and toggles it on click, so a quick
 * hover-then-click (the usual way people press a menu) opened it and shut it again. A click within
 * 400 ms of the menu opening keeps it open instead.
 */
function useMenuValue() {
  const [value, setValue] = useState('')
  const openedAt = useRef(0)
  const onValueChange = useCallback((v: string) => {
    if (v) openedAt.current = performance.now()
    setValue(v)
  }, [])
  // Escape closes the open menu and puts focus back on its trigger (Radix can leave it on <body> when
  // the focused item unmounts with the panel).
  useEffect(() => {
    if (!value) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = document.querySelector<HTMLElement>(`[data-menu-trigger="${value}"]`)
      setValue('')
      requestAnimationFrame(() => t?.focus())
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [value])
  const guard = (id: string) => (e: ReactMouseEvent) => {
    if (value === id && performance.now() - openedAt.current < 400) e.preventDefault()
  }
  return { value, onValueChange, guard }
}
type Guard = (id: string) => (e: ReactMouseEvent) => void

const trigger =
  'group relative inline-flex min-h-11 items-center gap-[6px] rounded-btn px-3 text-[14px] whitespace-nowrap transition-colors hover:text-ink data-[state=open]:text-ink'
// A short gold bar under the item for the section you are in.
const activeBar = 'after:absolute after:inset-x-3 after:bottom-[6px] after:h-[2px] after:rounded-full after:bg-gold'
const panel =
  'gl-menu-panel absolute top-[calc(100%+8px)] z-50 rounded-card border border-line-strong bg-surface-deep p-2 shadow-[0_18px_48px_rgba(0,0,0,.55)]'

function EntryBody({ e, active }: { e: NavEntry; active?: boolean }) {
  return (
    <>
      <span
        aria-hidden
        className={`grid size-9 flex-none place-items-center rounded-[8px] border transition-colors ${active ? 'border-gold-line bg-[rgba(232,192,96,.08)] text-gold' : 'border-line bg-bg text-faint group-hover:text-gold group-focus-visible:text-gold'}`}
      >
        <e.icon size={17} strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-col gap-[2px]">
        <span className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          {e.label}
          {e.badge && <span className={`rounded-full border px-[7px] py-[1px] font-mono text-[11px] tracking-[.5px] uppercase ${e.badge === 'New' ? 'border-gold bg-gold text-bg' : 'border-gold-line text-gold'}`}>{e.badge}</span>}
          {e.newTab && <NewTabMark />}
        </span>
        <span className="text-[13px] leading-[1.35] text-muted">{e.desc}</span>
      </span>
    </>
  )
}

const panelItem = 'group flex min-h-11 w-full items-start gap-3 rounded-[8px] p-3 text-left transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover data-[active]:bg-[rgba(232,192,96,.05)]'

function MenuGroup({ g, pathname, hash, wide, guard }: { g: NavGroup; pathname: string; hash: string; wide?: boolean; guard: Guard }) {
  const active = groupActive(g, pathname, hash)
  return (
    <NavigationMenu.Item value={g.id} className="relative">
      <NavigationMenu.Trigger onClick={guard(g.id)} data-menu-trigger={g.id} className={`${trigger} ${active ? `text-ink ${activeBar}` : 'text-muted'}`}>
        <g.icon aria-hidden size={16} strokeWidth={1.75} className={`flex-none transition-colors ${active ? 'text-gold' : 'text-faint group-hover:text-gold group-data-[state=open]:text-gold'}`} />
        {g.label}
        <ChevronDown aria-hidden size={14} strokeWidth={2} className="gl-chevron text-faint" />
      </NavigationMenu.Trigger>
      <NavigationMenu.Content className={`${panel} left-0 ${wide ? 'grid w-[620px] grid-cols-2 gap-1' : 'flex w-[340px] flex-col gap-1'}`}>
        {g.items.map((e) => {
          const on = entryActive(e, pathname, hash)
          return (
            <NavigationMenu.Link key={e.label} asChild active={on}>
              <EntryLink e={e} className={panelItem}>
                <EntryBody e={e} active={on} />
              </EntryLink>
            </NavigationMenu.Link>
          )
        })}
      </NavigationMenu.Content>
    </NavigationMenu.Item>
  )
}

function PlainLink({ e, pathname, hash }: { e: NavEntry; pathname: string; hash: string }) {
  const on = entryActive(e, pathname, hash)
  return (
    <NavigationMenu.Item>
      <NavigationMenu.Link asChild active={on}>
        <EntryLink e={e} className={`${trigger} ${on ? `text-ink ${activeBar}` : 'text-muted'}`}>
          <e.icon aria-hidden size={16} strokeWidth={1.75} className={`flex-none transition-colors ${on ? 'text-gold' : 'text-faint group-hover:text-gold'}`} />
          {e.label}
        </EntryLink>
      </NavigationMenu.Link>
    </NavigationMenu.Item>
  )
}

/** "Launch app": the main part opens the tracker; the chevron opens a menu of the apps. */
function LaunchApp({ compact }: { compact?: boolean }) {
  const { pathname, hash } = useLocation()
  const menu = useMenuValue()
  return (
    <NavigationMenu.Root aria-label="Apps" delayDuration={150} value={menu.value} onValueChange={menu.onValueChange} className="relative">
      <NavigationMenu.List className="m-0 flex list-none items-stretch p-0">
        <NavigationMenu.Item>
          <NavigationMenu.Link asChild>
            <Link to={launchApp.to} className={`${btnGold} inline-flex min-h-11 items-center gap-2 px-4 text-[14px] whitespace-nowrap ${compact ? '' : 'rounded-r-none'}`}>
              <AppWindow aria-hidden size={16} strokeWidth={2} />
              Launch app
            </Link>
          </NavigationMenu.Link>
        </NavigationMenu.Item>
        {!compact && (
          <NavigationMenu.Item value="apps" className="relative">
            <NavigationMenu.Trigger
              onClick={menu.guard('apps')}
              data-menu-trigger="apps"
              aria-label="More apps"
              className={`${btnGold} inline-flex min-h-11 w-11 items-center justify-center rounded-l-none border-l border-[rgba(11,14,19,.25)] data-[state=open]:bg-gold-hover`}
            >
              <ChevronDown aria-hidden size={16} strokeWidth={2.25} className="gl-chevron" />
            </NavigationMenu.Trigger>
            <NavigationMenu.Content className={`${panel} right-0 flex w-[320px] flex-col gap-1`}>
              {launchApp.items.map((e) => {
                const on = !!e.to && entryActive({ ...e, match: [e.to] }, pathname, hash)
                return (
                  <NavigationMenu.Link key={e.label} asChild active={on}>
                    <EntryLink e={e} className={panelItem}>
                      <EntryBody e={e} active={on} />
                    </EntryLink>
                  </NavigationMenu.Link>
                )
              })}
            </NavigationMenu.Content>
          </NavigationMenu.Item>
        )}
      </NavigationMenu.List>
    </NavigationMenu.Root>
  )
}

/** A gold hairline along the header's bottom edge that fills as you read; only on long pages. */
function ScrollProgress() {
  const bar = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()
  useEffect(() => {
    let frame = 0
    const paint = () => {
      frame = 0
      const el = bar.current
      if (!el) return
      const room = document.documentElement.scrollHeight - window.innerHeight
      const long = room > window.innerHeight * 1.5
      el.style.opacity = long ? '1' : '0'
      el.style.transform = `scaleX(${long ? Math.min(1, Math.max(0, window.scrollY / room)) : 0})`
    }
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(paint)
    }
    paint()
    window.addEventListener('scroll', queue, { passive: true })
    window.addEventListener('resize', queue)
    // Pages grow as their data arrives; re-measure when the document's height changes.
    const ro = new ResizeObserver(queue)
    ro.observe(document.body)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', queue)
      window.removeEventListener('resize', queue)
      ro.disconnect()
    }
  }, [pathname])
  return <div ref={bar} aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-px h-[2px] origin-left bg-gold opacity-0 transition-opacity duration-300" style={{ transform: 'scaleX(0)' }} />
}

/* ------------------------------------------------------------------ mobile sheet --- */

function SheetGroup({ g, open, onToggle, onPick, pathname, hash }: { g: NavGroup; open: boolean; onToggle: () => void; onPick: () => void; pathname: string; hash: string }) {
  const id = useId()
  const active = groupActive(g, pathname, hash)
  return (
    <div className="border-b border-line">
      <h2 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
          className={`flex min-h-14 w-full items-center justify-between gap-3 py-3 text-left font-display text-[24px] font-bold uppercase ${active ? 'text-ink' : 'text-ink-2'}`}
        >
          <span className="flex items-center gap-3">
            <g.icon aria-hidden size={20} strokeWidth={1.75} className={active ? 'text-gold' : 'text-faint'} />
            {g.label}
            {active && <span aria-hidden className="size-[6px] rounded-full bg-gold" />}
          </span>
          <ChevronDown aria-hidden size={20} className="gl-chevron text-faint" />
        </button>
      </h2>
      <div id={id} role="region" aria-label={g.label} inert={!open} className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <ul className="m-0 flex list-none flex-col gap-1 p-0 pb-4">
            {g.items.map((e) => {
              const on = entryActive(e, pathname, hash)
              return (
                <li key={e.label}>
                  <EntryLink e={e} onPick={onPick} current={on} className={panelItem}>
                    <EntryBody e={e} active={on} />
                  </EntryLink>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}

function MobileSheet({ onClose, returnFocus }: { onClose: () => void; returnFocus: () => void }) {
  const { pathname, hash } = useLocation()
  const ref = useRef<HTMLDivElement>(null)
  // The group holding the current page starts open (the sheet mounts fresh on each opening).
  const [expanded, setExpanded] = useState<string | null>(() => navGroups.find((g) => groupActive(g, pathname, hash))?.id ?? null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        returnFocus()
        return
      }
      if (e.key !== 'Tab' || !ref.current) return
      const items = [...ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')].filter((el) => !el.closest('[inert]'))
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus())
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose, returnFocus])

  const pick = onClose
  const { openContact } = useContact()
  return createPortal(
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Site menu" className="gl-sheet fixed inset-0 z-[70] flex flex-col bg-bg font-sans text-ink">
      <div className="flex min-h-16 items-center justify-between gap-4 border-b border-line px-page py-2">
        <Link to="/" onClick={pick} className="inline-flex min-h-11 items-center rounded-btn text-ink" aria-label="Gully Labs home">
          <Wordmark size={26} />
        </Link>
        <button
          type="button"
          data-autofocus
          onClick={() => {
            onClose()
            returnFocus()
          }}
          className="inline-flex min-h-11 items-center gap-2 rounded-btn border border-line-strong px-4 font-mono text-[13px] text-ink"
        >
          <X aria-hidden size={16} /> Close
        </button>
      </div>
      <nav aria-label="Mobile" className="flex-1 overflow-y-auto overscroll-contain px-page pt-2 pb-8">
        {navGroups.map((g) => (
          <SheetGroup key={g.id} g={g} open={expanded === g.id} onToggle={() => setExpanded((x) => (x === g.id ? null : g.id))} onPick={pick} pathname={pathname} hash={hash} />
        ))}
        {navLinks.map((e) => {
          const on = entryActive(e, pathname, hash)
          return (
            <EntryLink key={e.label} e={e} onPick={pick} current={on} className={`flex min-h-14 items-center gap-3 border-b border-line py-3 font-display text-[24px] font-bold uppercase ${on ? 'text-ink' : 'text-ink-2'}`}>
              <e.icon aria-hidden size={20} strokeWidth={1.75} className={on ? 'text-gold' : 'text-faint'} />
              {e.label}
              {on && <span aria-hidden className="size-[6px] rounded-full bg-gold" />}
            </EntryLink>
          )
        })}
        <button
          type="button"
          onClick={() => {
            pick()
            openContact()
          }}
          className={`${btnGold} mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 px-4 text-[15px]`}
        >
          <Send aria-hidden size={16} strokeWidth={2} />
          Start a project
        </button>
        <div className="mt-6 flex flex-col gap-2">
          <span className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[1px] text-faint">
            <AppWindow aria-hidden size={14} />
            LAUNCH APP
          </span>
          <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
            {launchApp.items.map((e, i) => (
              <EntryLink
                key={e.label}
                e={e}
                onPick={pick}
                className={
                  i === 0
                    ? `${btnGold} inline-flex min-h-12 items-center justify-center gap-2 px-4 text-[15px]`
                    : 'inline-flex min-h-12 items-center justify-center gap-2 rounded-btn border border-line-strong px-4 text-[15px] text-ink transition-colors hover:border-gold'
                }
              >
                <e.icon aria-hidden size={16} strokeWidth={1.75} />
                {e.label}
                {'newTab' in e && e.newTab && <NewTabMark size={14} className="flex-none opacity-70" />}
              </EntryLink>
            ))}
          </div>
        </div>
        <div className="mt-6 flex gap-2">
          {socialLinks.map((s) => (
            <a key={s.label} href={s.href} {...newTab} aria-label={`${s.name} (opens in a new tab)`} className="inline-flex size-11 items-center justify-center rounded-btn border border-line-strong text-muted hover:border-gold hover:text-ink">
              <SocialIcon name={s.label} />
            </a>
          ))}
        </div>
      </nav>
    </div>,
    document.body,
  )
}

/* ------------------------------------------------------------------------ header --- */

export function Header() {
  const { pathname, hash } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const [products, developers, company] = navGroups
  const menu = useMenuValue()

  // The sheet closes when the viewport widens to the desktop bar, and on any navigation.
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY)
    const onChange = () => mq.matches && setMenuOpen(false)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const [lastPath, setLastPath] = useState(pathname + hash)
  if (lastPath !== pathname + hash) {
    setLastPath(pathname + hash)
    setMenuOpen(false)
  }

  const close = useCallback(() => setMenuOpen(false), [])
  const focusMenuButton = useCallback(() => requestAnimationFrame(() => menuButton.current?.focus()), [])

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-[rgba(11,14,19,.86)] backdrop-blur-[10px]">
      <div className="flex min-h-16 items-center gap-4 px-page py-2 min-[1024px]:gap-6">
        <Link to="/" className="inline-flex min-h-11 flex-none items-center rounded-btn text-ink" aria-label="Gully Labs home">
          <Wordmark size={26} shimmer />
        </Link>

        <NavigationMenu.Root aria-label="Main" delayDuration={120} value={menu.value} onValueChange={menu.onValueChange} className="hidden min-[1024px]:block">
          <NavigationMenu.List className="m-0 flex list-none items-center gap-[2px] p-0">
            <MenuGroup g={products} pathname={pathname} hash={hash} guard={menu.guard} wide />
            <MenuGroup g={developers} pathname={pathname} hash={hash} guard={menu.guard} />
            {navLinks.map((e) => (
              <PlainLink key={e.label} e={e} pathname={pathname} hash={hash} />
            ))}
            <MenuGroup g={company} pathname={pathname} hash={hash} guard={menu.guard} />
          </NavigationMenu.List>
        </NavigationMenu.Root>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden min-[1024px]:block">
            <LaunchApp />
          </div>
          <div className="max-[359px]:hidden min-[1024px]:hidden">
            <LaunchApp compact />
          </div>
          <button
            ref={menuButton}
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            className="inline-flex min-h-11 items-center gap-2 rounded-btn border border-line-strong bg-transparent px-3 font-mono text-[13px] text-ink min-[1024px]:hidden"
          >
            <Menu aria-hidden size={16} />
            Menu
          </button>
        </div>
      </div>
      <ScrollProgress />
      {menuOpen && <MobileSheet onClose={close} returnFocus={focusMenuButton} />}
    </header>
  )
}
