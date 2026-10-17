import { Activity, Bot, BookOpen, Building2, ChartCandlestick, Check, ChevronsLeft, ChevronsRight, ChevronsUpDown, Copy, History, House, LogOut, Mail, Menu as MenuIcon, ShieldCheck, UserRound, Users, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { VenueLogo } from '../../components/logos/VenueLogo'
import { Wordmark } from '../../components/Wordmark'
import { copyWithToast } from '../../components/ui/toast'
import { DOCS_URL, isLocalHost, SITE_URL } from '../../site-host'
import { daysLeft, shortAddress, type Account, type Role } from './api'
import { Avatar } from './Avatar'
import { Menu, menuItem } from './Menu'
import { declinedInvites, restoreFocus, usePortal } from './portal'

/* The Gully Labs App's frame (app.gullylabs.xyz): a left sidebar and a slim header around the page.

   Sidebar, top to bottom: the Gully mark and "Gully Labs App", the workspace switcher, the pages (16px
   icons and labels, the current one marked with aria-current), then Docs ↗, Tracker, Gully AI, Status,
   the gullylabs.xyz home link and the wallet menu. From 1280px it is open (232px); from 860px to 1279px it starts collapsed to icons
   (64px, labels kept for screen readers and as tooltips); the chevron button toggles it at any width
   and the choice is remembered. Under 860px there is no sidebar: a Menu button in the header opens the
   same items as a bottom sheet (a modal dialog: focus moves in, Tab stays in, Escape closes).

   Header: a Menu button and the Gully mark linking home (narrow screens, so home is one tap away at every
   width), the breadcrumb (workspace / page), the plan pill, and the
   wallet menu on narrow screens (wide screens have it at the foot of the sidebar). */

export type NavItem<T extends string> = { id: T; label: string; icon: ReactNode; badge?: ReactNode }

const ICON = 16
const NARROW = '(max-width: 859.98px)'
const WIDE = '(min-width: 1280px)'
const PREF = 'gully:app-sidebar'

/** A media query as React state. */
function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

function readPref(): 'open' | 'icons' | null {
  try {
    const v = localStorage.getItem(PREF)
    return v === 'open' || v === 'icons' ? v : null
  } catch {
    return null
  }
}

const site = (path: string) => (isLocalHost() ? path : `${SITE_URL}${path}`)
const roleTone = (r: Role) => (r === 'owner' ? 'border-gold text-gold' : r === 'admin' ? 'border-gold-line text-gold' : 'border-line-strong text-muted')

/* ------------------------------------------------------------------ status --- */

type Health = 'checking' | 'up' | 'down'

/** Whether this server answers (GET /healthz), every minute while the tab is visible. */
function useHealth(): Health {
  const [h, setH] = useState<Health>('checking')
  useEffect(() => {
    let alive = true
    const ping = () => {
      if (document.visibilityState === 'hidden') return
      fetch('/healthz', { cache: 'no-store' }).then(
        (r) => alive && setH(r.ok ? 'up' : 'down'),
        () => alive && setH('down'),
      )
    }
    ping()
    const id = setInterval(ping, 60_000)
    document.addEventListener('visibilitychange', ping)
    return () => {
      alive = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', ping)
    }
  }, [])
  return h
}

const healthText: Record<Health, string> = { checking: 'checking…', up: 'API online', down: 'API unreachable' }
const healthDot: Record<Health, string> = { checking: 'bg-faint animate-pulse', up: 'bg-green', down: 'bg-error' }

/* --------------------------------------------------------- workspace switch --- */

function WorkspaceSwitcher({ compact, onTeam }: { compact: boolean; onTeam: () => void }) {
  const { me, role, switchTo } = usePortal()
  if (!me) return null
  const active = me.active
  return (
    <Menu
      label={`Workspace: ${active.name}, you are ${role}. Switch workspace`}
      testId="workspace-switcher"
      align="left"
      width={300}
      buttonClass={`flex min-h-11 w-full items-center gap-2 rounded-[10px] border border-line-strong bg-surface text-[13px] text-ink transition-colors hover:border-line-hover ${compact ? 'justify-center px-0' : 'px-3'}`}
      button={
        <>
          <Building2 size={ICON} className="shrink-0 text-gold" aria-hidden />
          {!compact && (
            <>
              <span className="min-w-0 flex-1 truncate text-left font-medium">{active.name}</span>
              <span className={`shrink-0 rounded-full border px-[6px] font-mono text-[11px] ${roleTone(role)}`}>{role}</span>
              <ChevronsUpDown size={14} className="shrink-0 text-faint" aria-hidden />
            </>
          )}
        </>
      }
    >
      {(close) => (
        <>
          <span className="px-3 pt-2 pb-1 font-mono text-[11px] tracking-[1px] text-faint">WORKSPACES</span>
          {me.workspaces.map((w) => (
            <button
              key={w.id}
              role="menuitem"
              type="button"
              className={menuItem}
              data-workspace={w.id}
              onClick={async () => {
                close()
                if (w.id !== active.id) await switchTo(w.id)
              }}
            >
              {w.id === me.address ? <UserRound size={ICON} aria-hidden /> : <Building2 size={ICON} aria-hidden />}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{w.name}</span>
                <span className="font-mono text-[11px] text-faint">{w.id === me.address ? 'yours' : `owner ${shortAddress(w.owner)}`}</span>
              </span>
              <span className={`rounded-full border px-[6px] font-mono text-[11px] ${roleTone(w.role)}`}>{w.role}</span>
              {w.id === active.id ? <Check size={ICON} className="text-gold" aria-label="active" /> : <span className="w-4" aria-hidden />}
            </button>
          ))}
          <span className="my-1 h-px bg-line" aria-hidden />
          <button
            role="menuitem"
            type="button"
            className={menuItem}
            onClick={() => {
              close()
              onTeam()
            }}
          >
            <Users size={ICON} aria-hidden /> Team and invites
          </button>
        </>
      )}
    </Menu>
  )
}

/** The workspaces as a plain list (inside the mobile sheet, where a nested dropdown would be clipped). */
function WorkspaceList({ onDone }: { onDone: () => void }) {
  const { me, switchTo } = usePortal()
  if (!me) return null
  return (
    <div className="flex flex-col gap-1" role="group" aria-label="Workspaces">
      <span className="px-1 font-mono text-[11px] tracking-[1px] text-faint">WORKSPACE</span>
      {me.workspaces.map((w) => {
        const on = w.id === me.active.id
        return (
          <button
            key={w.id}
            type="button"
            aria-pressed={on}
            data-workspace={w.id}
            className={`flex min-h-11 items-center gap-3 rounded-[10px] border px-3 text-left text-[14px] ${on ? 'border-gold-line bg-surface text-ink' : 'border-line text-ink-2 hover:border-line-hover'}`}
            onClick={async () => {
              if (!on) await switchTo(w.id)
              onDone()
            }}
          >
            {w.id === me.address ? <UserRound size={ICON} aria-hidden /> : <Building2 size={ICON} className="text-gold" aria-hidden />}
            <span className="min-w-0 flex-1 truncate">{w.name}</span>
            <span className={`rounded-full border px-[6px] font-mono text-[11px] ${roleTone(w.role)}`}>{w.role}</span>
            {on && <Check size={ICON} className="text-gold" aria-label="active" />}
          </button>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------- wallet menu --- */

export type WalletGo = { profile: () => void; team: () => void; activity: () => void; sessions: () => void; invites: () => void }

function WalletMenu({ onSignOut, go, compact = false, placement = 'down' }: { onSignOut: () => void; go: WalletGo; compact?: boolean; placement?: 'down' | 'up' }) {
  const { me, user } = usePortal()
  const address = me?.address ?? user
  const pending = (me?.pendingInvites ?? []).filter((i) => !declinedInvites()[i.id]).length
  const label = me?.profile.displayName ?? me?.profile.ens ?? shortAddress(address)
  const item = (icon: ReactNode, text: string, onClick: () => void, extra = '') => ({ icon, text, onClick, extra })
  const inSidebar = placement === 'up'
  return (
    <Menu
      label={`Wallet ${address}${pending ? `, ${pending} invite${pending === 1 ? '' : 's'} waiting` : ''}`}
      testId="wallet-menu"
      width={250}
      align={inSidebar ? 'left' : 'right'}
      placement={placement}
      buttonClass={`relative flex min-h-11 items-center gap-2 rounded-full border border-line-strong bg-surface font-mono text-[12px] text-ink transition-colors hover:border-line-hover ${compact ? 'justify-center px-[9px]' : 'px-2 pr-3'} ${inSidebar && !compact ? 'w-full' : ''}`}
      button={
        <>
          <Avatar address={address} src={me?.profile.avatar} size={24} />
          {!compact && <span className={`truncate ${inSidebar ? 'min-w-0 flex-1 text-left' : 'max-w-[120px] max-[420px]:hidden'}`}>{label}</span>}
          {pending > 0 && <span className="absolute -top-[2px] -right-[2px] size-[10px] rounded-full border-2 border-bg bg-gold" aria-hidden data-testid="invite-dot" />}
        </>
      }
    >
      {(close) => (
        <>
          <span className="px-3 pt-2 font-mono text-[11px] break-all text-faint">{address}</span>
          <span className="px-3 pb-2 text-[11px] text-faint">{me?.profile.ens ? `${me.profile.ens} · ` : ''}signed in with this wallet (SIWE)</span>
          {[
            ...(pending ? [item(<Mail size={ICON} aria-hidden />, `${pending} invite${pending === 1 ? '' : 's'} waiting`, go.invites, 'text-gold')] : []),
            item(<UserRound size={ICON} aria-hidden />, 'Profile', go.profile),
            item(<Users size={ICON} aria-hidden />, 'Team', go.team),
            item(<History size={ICON} aria-hidden />, 'Activity', go.activity),
            item(<ShieldCheck size={ICON} aria-hidden />, 'Sessions', go.sessions),
            item(<Copy size={ICON} aria-hidden />, 'Copy address', () => void copyWithToast(address, 'Address')),
          ].map((x) => (
            <button
              key={x.text}
              role="menuitem"
              type="button"
              className={`${menuItem} ${x.extra}`}
              onClick={() => {
                close()
                x.onClick()
              }}
            >
              {x.icon} {x.text}
            </button>
          ))}
          <span className="my-1 h-px bg-line" aria-hidden />
          <button
            role="menuitem"
            type="button"
            className={`${menuItem} hover:!text-error`}
            onClick={() => {
              close()
              onSignOut()
            }}
          >
            <LogOut size={ICON} aria-hidden /> Sign out
          </button>
        </>
      )}
    </Menu>
  )
}

function PlanPill({ account }: { account: Account }) {
  const left = daysLeft(account.plan.expiresAt)
  const paid = account.plan.id !== 'free'
  const soon = left !== null && left <= 7
  return (
    <span className="flex min-h-[30px] items-center gap-2 rounded-full border border-line px-[10px] text-[13px] whitespace-nowrap" title={account.plan.expiresAt ? `Runs until ${new Date(account.plan.expiresAt).toLocaleString()}` : undefined} data-testid="plan-pill">
      <span className="size-2 rounded-full" style={{ background: !paid ? '#7f8b9c' : soon ? '#ff8a7a' : '#e8c060' }} aria-hidden />
      {account.plan.name} plan
      {left !== null && <span className={`${soon ? 'text-error' : 'text-muted'} max-[520px]:hidden`}>· {left === 0 ? 'ends today' : `${left} day${left === 1 ? '' : 's'} left`}</span>}
    </span>
  )
}

/* ------------------------------------------------------------------- items --- */

function NavLinks<T extends string>({ items, current, go, compact }: { items: NavItem<T>[]; current: T; go: (t: T) => void; compact: boolean }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-[2px] p-0">
      {items.map((t) => {
        const on = current === t.id
        return (
          <li key={t.id}>
            <a
              href={`#${t.id}`}
              id={`nav-${t.id}`}
              aria-current={on ? 'page' : undefined}
              title={compact ? t.label : undefined}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                e.preventDefault()
                go(t.id)
              }}
              className={`relative flex min-h-11 items-center gap-3 rounded-[10px] text-[14px] font-medium transition-colors ${compact ? 'justify-center px-0' : 'px-3'} ${on ? 'bg-surface text-ink' : 'text-dim hover:bg-surface-hover hover:text-ink'}`}
            >
              {on && <span className="absolute top-[10px] bottom-[10px] left-0 w-[3px] rounded-full bg-gold" aria-hidden />}
              <span className={on ? 'text-gold' : ''}>{t.icon}</span>
              <span className={compact ? 'sr-only' : 'flex-1 truncate'}>{t.label}</span>
              {!compact && t.badge}
            </a>
          </li>
        )
      })}
    </ul>
  )
}

const footItem = (compact: boolean) => `flex min-h-11 items-center gap-3 rounded-[10px] text-[13px] text-muted transition-colors hover:bg-surface-hover hover:text-ink ${compact ? 'justify-center px-0' : 'px-3'}`

function FooterLinks({ compact, health, onStatus }: { compact: boolean; health: Health; onStatus: () => void }) {
  const txt = (s: string) => <span className={compact ? 'sr-only' : 'flex-1 truncate'}>{s}</span>
  return (
    <ul className="m-0 flex list-none flex-col gap-[2px] p-0">
      <li>
        <a href={`${DOCS_URL}/api`} target="_blank" rel="noopener noreferrer" className={footItem(compact)} title={compact ? 'Docs (opens in a new tab)' : undefined}>
          <BookOpen size={ICON} aria-hidden /> {txt('Docs ↗')}
          {compact && <span className="sr-only"> (opens in a new tab)</span>}
        </a>
      </li>
      <li>
        <a href={site('/tracker')} className={footItem(compact)} title={compact ? 'Tracker' : undefined}>
          <ChartCandlestick size={ICON} aria-hidden /> {txt('Tracker')}
        </a>
      </li>
      <li>
        <a href={site('/ask')} className={footItem(compact)} title={compact ? 'Gully AI' : undefined}>
          <Bot size={ICON} aria-hidden /> {txt('Gully AI')}
        </a>
      </li>
      <li>
        <button type="button" onClick={onStatus} className={`${footItem(compact)} w-full text-left`} title={compact ? `Status: ${healthText[health]}` : undefined} data-testid="status-link" data-health={health}>
          <span className="relative inline-flex">
            <Activity size={ICON} aria-hidden />
            <span className={`absolute -right-[3px] -bottom-[2px] size-[7px] rounded-full border border-bg ${healthDot[health]}`} aria-hidden />
          </span>
          {txt('Status')}
          {compact ? <span className="sr-only">: {healthText[health]}</span> : <span className="font-mono text-[11px] text-faint">{healthText[health]}</span>}
        </button>
      </li>
      <li>
        <a href={SITE_URL} className={footItem(compact)} title={compact ? 'Gully Labs home' : undefined} data-testid="home-link">
          <House size={ICON} aria-hidden /> {txt('gullylabs.xyz')}
        </a>
      </li>
    </ul>
  )
}

function Brand({ compact, onHome }: { compact: boolean; onHome: () => void }) {
  return (
    <button type="button" onClick={onHome} className={`flex min-h-11 min-w-0 items-center gap-[10px] text-ink ${compact ? 'justify-center' : ''}`} aria-label="Gully Labs App: overview" data-testid="app-brand">
      <VenueLogo venue="gully" name="Gully Labs" size={24} decorative />
      {!compact && (
        <span className="flex min-w-0 items-baseline gap-2">
          <Wordmark size={18} />
          <span className="font-semibold text-muted">App</span>
        </span>
      )}
    </button>
  )
}

/* ------------------------------------------------------------- mobile sheet --- */

function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const id = requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[aria-current="page"], a, button')?.focus())
    return () => {
      cancelAnimationFrame(id)
      document.body.style.overflow = overflow
      restoreFocus(prev)
    }
  }, [open])
  if (!open) return null
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      return onClose()
    }
    if (e.key !== 'Tab') return
    const f = [...(panel.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [])]
    if (!f.length) return
    const first = f[0]
    const last = f[f.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
  return (
    <div className="fixed inset-0 z-50 print:hidden" onKeyDown={onKey}>
      <div className="absolute inset-0 animate-[gl-fade_.2s_ease_both] bg-[rgba(5,7,10,.72)]" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="App menu"
        data-testid="app-sheet"
        className="absolute inset-x-0 bottom-0 flex max-h-[86dvh] animate-[gl-rise_.24s_cubic-bezier(.2,.8,.2,1)_both] flex-col gap-4 overflow-y-auto rounded-t-[18px] border-t border-line-strong bg-surface-deep px-4 pt-2 pb-[max(16px,env(safe-area-inset-bottom))] shadow-[0_-16px_48px_rgba(0,0,0,.5)]"
      >
        <span className="mx-auto mt-1 h-1 w-10 shrink-0 rounded-full bg-line-strong" aria-hidden />
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] tracking-[1px] text-faint">GULLY LABS APP</span>
          <button type="button" onClick={onClose} className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:text-ink" aria-label="Close menu">
            <X size={18} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- shell --- */

export function AppShell<T extends string>({
  items,
  current,
  go,
  account,
  pageLabel,
  wallet,
  onSignOut,
  children,
}: {
  items: NavItem<T>[]
  current: T
  go: (t: T) => void
  account: Account
  pageLabel: string
  wallet: WalletGo
  onSignOut: () => void
  children: ReactNode
}) {
  const { me } = usePortal()
  const narrow = useMedia(NARROW)
  const wide = useMedia(WIDE)
  const [pref, setPref] = useState(readPref)
  const compact = !narrow && (pref ? pref === 'icons' : !wide)
  const [sheetWanted, setSheet] = useState(false)
  // The sheet exists only in the narrow layout: widening the window closes it.
  const sheet = sheetWanted && narrow
  const health = useHealth()
  const menuBtn = useRef<HTMLButtonElement>(null)

  const toggle = () => {
    const next = compact ? 'open' : 'icons'
    setPref(next)
    try {
      localStorage.setItem(PREF, next)
    } catch {
      /* private mode: not remembered */
    }
  }
  const pick = useCallback(
    (t: T) => {
      setSheet(false)
      go(t)
    },
    [go],
  )
  const first = items[0].id
  const status = () => {
    setSheet(false)
    const products = items.find((i) => i.id === ('products' as T))
    go(products ? products.id : first)
  }
  const ws = me?.active.name ?? 'Your workspace'

  return (
    <div className="flex min-h-dvh" data-testid="app-shell" data-sidebar={narrow ? 'sheet' : compact ? 'icons' : 'open'}>
      {!narrow && (
        <aside aria-label="App" className={`sticky top-0 flex h-dvh shrink-0 flex-col gap-3 border-r border-line bg-bg-alt py-3 transition-[width] duration-200 print:hidden ${compact ? 'w-16 px-2' : 'w-[232px] px-3'}`} data-testid="app-sidebar">
          <div className={`flex items-center gap-1 ${compact ? 'flex-col' : 'justify-between'}`}>
            <Brand compact={compact} onHome={() => go(first)} />
            <button type="button" onClick={toggle} className="inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] text-faint transition-colors hover:bg-surface-hover hover:text-ink" aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar to icons'} aria-expanded={!compact} data-testid="sidebar-toggle">
              {compact ? <ChevronsRight size={ICON} aria-hidden /> : <ChevronsLeft size={ICON} aria-hidden />}
            </button>
          </div>
          <WorkspaceSwitcher compact={compact} onTeam={wallet.team} />
          <nav aria-label="App pages" className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 [scrollbar-width:thin]">
            <NavLinks items={items} current={current} go={go} compact={compact} />
          </nav>
          <div className="flex flex-col gap-2 border-t border-line pt-2">
            <FooterLinks compact={compact} health={health} onStatus={status} />
            <WalletMenu onSignOut={onSignOut} go={wallet} compact={compact} placement="up" />
          </div>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-[rgba(11,14,19,.86)] backdrop-blur-md print:hidden">
          <div className="flex min-h-14 items-center gap-3 px-6 max-[480px]:px-4">
            {narrow && (
              <>
                <button ref={menuBtn} type="button" onClick={() => setSheet(true)} className="-ml-2 inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] text-ink hover:bg-surface-hover" aria-label="Open menu" aria-haspopup="dialog" aria-expanded={sheet} data-testid="menu-button">
                  <MenuIcon size={20} aria-hidden />
                </button>
                <a href={SITE_URL} className="inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] hover:bg-surface-hover" aria-label="Gully Labs home" data-testid="home-link-header">
                  <VenueLogo venue="gully" name="Gully Labs" size={24} decorative />
                </a>
              </>
            )}
            <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
              <ol className="m-0 flex min-w-0 list-none items-center gap-2 p-0 text-[14px]" data-testid="breadcrumb">
                <li className="min-w-0 truncate text-muted max-[520px]:hidden">{ws}</li>
                <li className="text-faint max-[520px]:hidden" aria-hidden>
                  /
                </li>
                <li className="min-w-0 truncate font-semibold text-ink" aria-current="page">
                  {pageLabel}
                </li>
              </ol>
            </nav>
            <PlanPill account={account} />
            {narrow && <WalletMenu onSignOut={onSignOut} go={wallet} />}
          </div>
        </header>

        {children}
      </div>

      <Sheet open={sheet} onClose={() => setSheet(false)}>
        <WorkspaceList onDone={() => setSheet(false)} />
        <nav aria-label="App pages">
          <NavLinks items={items} current={current} go={pick} compact={false} />
        </nav>
        <div className="border-t border-line pt-2">
          <FooterLinks compact={false} health={health} onStatus={status} />
        </div>
      </Sheet>
    </div>
  )
}
