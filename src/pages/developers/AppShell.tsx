import { Activity, BookOpen, Building2, Check, ChevronDown, ChevronsLeft, ChevronsRight, ChevronsUpDown, Copy, Ellipsis, History, House, LogOut, Mail, Menu as MenuIcon, ShieldCheck, UserRound, Users, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { Mascot, Wordmark } from '../../components/brand'
import { copyWithToast } from '../../components/ui/toast'
import { DOCS_URL, SITE_URL } from '../../site-host'
import { daysLeft, shortAddress, type Account, type Role } from './api'
import { AskLauncher } from '../../components/ask/AskLauncher'
import { healthOfStatus, useAppStatus, type Health } from './services/health'
import { StatusDialog } from './services/StatusDialog'
import { Avatar } from './Avatar'
import { Menu, menuItem } from './Menu'
import { declinedInvites, restoreFocus, usePortal } from './portal'
import { ExtLink } from './ExtLink'

/* The Gully Labs App's frame (app.gullylabs.xyz): a left sidebar and a slim header around the page.

   Sidebar, top to bottom: the Gully mark (home), the workspace switcher and the collapse button in one row,
   every page in one
   full-height list under folding group headings (Workspace, Services, Developer, Account; 34px rows with
   16px icons, the fold remembered), and the wallet menu. All 19 pages fit at 800px tall, so it has no inner
   scrollbar. From 1280px it is open (232px); from 860px to 1279px it starts as an icon rail (64px, each row
   with a tooltip); the chevron toggles it at any width and the choice is remembered. Under 860px there is
   no sidebar: a bottom tab bar holds Overview, Tracker, Keys and Alerts, and "More" (or the header's Menu
   button) opens every page as a bottom sheet (a modal dialog: focus moves in, Tab stays in, Escape closes).

   Header: a Menu button and the Gully mark linking home (narrow screens, so home is one tap away at every
   width), the breadcrumb (workspace / page), Docs ↗ / Status / gullylabs.xyz as icon buttons (wide
   screens), the plan pill, and the
   wallet menu on narrow screens (wide screens have it at the foot of the sidebar). */

/** One sidebar page. Items with a `group` are drawn under that group's heading, in the order given. */
export type NavItem<T extends string> = { id: T; label: string; icon: ReactNode; badge?: ReactNode; group?: string }

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

const roleTone = (r: Role) => (r === 'owner' ? 'border-gold text-gold' : r === 'admin' ? 'border-gold-line text-gold' : 'border-line-strong text-muted')

/* ------------------------------------------------------------------ status --- */

/** The API's state from the public status (GET /api/status on gullylabs.xyz, at least every minute); the button
    opens the Status dialog, which links to the full page at https://gullylabs.xyz/status. */
const useHealth = (): Health => healthOfStatus(useAppStatus(60_000))

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
      buttonClass={`flex min-h-[34px] relative after:absolute after:inset-x-0 after:-inset-y-[5px] w-full items-center gap-2 rounded-[10px] border border-line-strong bg-surface text-[13px] text-ink transition-colors hover:border-line-hover ${compact ? 'justify-center px-0' : 'px-3'}`}
      button={
        <>
          <Building2 size={ICON} className="shrink-0 text-gold" aria-hidden />
          {!compact && (
            <>
              <span className="min-w-[7ch] flex-1 truncate text-left font-medium" title={`${active.name} · ${role}`}>{/^0x[0-9a-fA-F]{40}$/.test(active.name) ? shortAddress(active.name) : active.name}</span>
              <span className="sr-only">{role}</span>
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
      buttonClass={`relative flex ${inSidebar ? 'min-h-11' : 'min-h-11'} items-center gap-2 rounded-full border border-line-strong bg-surface font-mono text-[12px] text-ink transition-colors hover:border-line-hover ${compact ? 'justify-center px-[9px]' : 'px-2 pr-3'} ${inSidebar && !compact ? 'w-full' : ''}`}
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
      <span className="size-2 rounded-full" style={{ background: !paid ? '#8a94a1' : soon ? '#ff8a7a' : '#d9b563' }} aria-hidden />
      {account.plan.name} plan
      {left !== null && <span className={`${soon ? 'text-error' : 'text-muted'} max-[520px]:hidden`}>· {left === 0 ? 'ends today' : `${left} day${left === 1 ? '' : 's'} left`}</span>}
    </span>
  )
}

/* ------------------------------------------------------------------- items --- */

const GROUPS_PREF = 'gully:app-nav-groups'

/** Which sidebar groups are folded, remembered in this browser. */
function useFolded(): [Set<string>, (g: string) => void] {
  const [folded, set] = useState<Set<string>>(() => {
    try {
      const v: unknown = JSON.parse(localStorage.getItem(GROUPS_PREF) ?? '[]')
      return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    } catch {
      return new Set()
    }
  })
  const toggle = (g: string) =>
    set((prev) => {
      const next = new Set(prev)
      if (next.has(g)) next.delete(g)
      else next.add(g)
      try {
        localStorage.setItem(GROUPS_PREF, JSON.stringify([...next]))
      } catch {
        /* private mode: not remembered */
      }
      return next
    })
  return [folded, toggle]
}

/** The rows. In the sidebar they are dense (32px); in the phone sheet they keep 44px tap targets. In the icon
    rail each row has a tooltip with its name (on hover and keyboard focus). */
function NavList<T extends string>({ items, current, go, compact, dense }: { items: NavItem<T>[]; current: T; go: (t: T) => void; compact: boolean; dense: boolean }) {
  return (
    <ul className={`m-0 flex list-none flex-col p-0 ${dense ? '' : 'gap-[2px]'}`}>
      {items.map((t) => {
        const on = current === t.id
        return (
          <li key={t.id}>
            <a
              href={`#${t.id}`}
              id={`nav-${t.id}`}
              aria-current={on ? 'page' : undefined}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                e.preventDefault()
                go(t.id)
              }}
              className={`group/row relative flex items-center gap-[10px] rounded-[8px] font-medium transition-colors ${dense ? 'min-h-8 text-[13px] [@media(max-height:820px)]:min-h-[30px]' : 'min-h-11 text-[14px]'} ${compact ? 'justify-center px-0' : 'px-[10px]'} ${on ? 'bg-surface text-ink' : 'text-dim hover:bg-surface-hover hover:text-ink'}`}
            >
              {on && <span className="absolute top-[8px] bottom-[8px] left-0 w-[3px] rounded-full bg-gold" aria-hidden />}
              <span className={on ? 'text-gold' : ''}>{t.icon}</span>
              <span className={compact ? 'sr-only' : 'flex-1 truncate'}>{t.label}</span>
              {!compact && t.badge}
              {compact && (
                <span className="pointer-events-none absolute top-1/2 left-[calc(100%+10px)] z-50 -translate-y-1/2 rounded-[8px] border border-line-strong bg-surface-deep px-[10px] py-[5px] text-[12px] whitespace-nowrap text-ink opacity-0 shadow-[0_8px_24px_rgba(0,0,0,.45)] transition-opacity duration-150 group-hover/row:opacity-100 group-focus-visible/row:opacity-100" aria-hidden data-tooltip>
                  {t.label}
                </span>
              )}
            </a>
          </li>
        )
      })}
    </ul>
  )
}

/** The pages under their group headings (Workspace, Services, Developer, Account). A heading folds its group
    (remembered); a folded group still shows the page you are on. In the icon rail a group is a thin rule,
    its name kept for screen readers, and nothing folds. */
function NavLinks<T extends string>({ items, current, go, compact, dense }: { items: NavItem<T>[]; current: T; go: (t: T) => void; compact: boolean; dense: boolean }) {
  const [folded, toggle] = useFolded()
  const groups: { name: string; items: NavItem<T>[] }[] = []
  for (const it of items) {
    const name = it.group ?? ''
    const last = groups[groups.length - 1]
    if (last && last.name === name) last.items.push(it)
    else groups.push({ name, items: [it] })
  }
  if (groups.length === 1 && !groups[0].name) return <NavList items={items} current={current} go={go} compact={compact} dense={dense} />
  return (
    <div className={`flex flex-col ${dense ? 'gap-1' : 'gap-3'}`} data-testid="nav-groups">
      {groups.map((g, i) => {
        const slug = g.name.toLowerCase().replace(/\W+/g, '-') || String(i)
        const id = `navgroup-${slug}`
        const shut = !compact && !!g.name && folded.has(g.name)
        const rows = shut ? g.items.filter((it) => it.id === current) : g.items
        return (
          <div key={g.name || i} role="group" aria-labelledby={id} data-nav-group={g.name} data-folded={shut || undefined} className={dense ? '[@media(max-height:840px)]:not-first:mt-1 [@media(max-height:840px)]:not-first:border-t [@media(max-height:840px)]:not-first:border-line' : undefined}>
            {compact ? (
              <span id={id} className="mx-auto my-[3px] block h-px w-6 bg-line-strong" aria-label={g.name} role="heading" aria-level={2}>
                <span className="sr-only">{g.name}</span>
              </span>
            ) : (
              <h2 id={id} className={dense ? 'm-0 [@media(max-height:840px)]:sr-only' : 'm-0'}>
                <button type="button" onClick={() => toggle(g.name)} aria-expanded={!shut} aria-controls={`${id}-list`} className={`group/h flex w-full items-center gap-1 rounded-[6px] px-[10px] text-left font-mono text-[11px] font-normal tracking-[1px] text-faint uppercase transition-colors hover:text-ink-2 ${dense ? 'min-h-[18px]' : 'min-h-9'}`} data-testid={`navgroup-toggle-${slug}`}>
                  <span className="flex-1">{g.name}</span>
                  <ChevronDown size={12} className={`opacity-60 transition-transform duration-200 group-hover/h:opacity-100 ${shut ? '-rotate-90' : ''}`} aria-hidden />
                </button>
              </h2>
            )}
            <div id={`${id}-list`}>
              <NavList items={rows} current={current} go={go} compact={compact} dense={dense} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

const footItem = (compact: boolean) => `flex min-h-11 items-center gap-3 rounded-[10px] text-[13px] text-muted transition-colors hover:bg-surface-hover hover:text-ink ${compact ? 'justify-center px-0' : 'px-3'}`

function FooterLinks({ compact, health, onStatus }: { compact: boolean; health: Health; onStatus: () => void }) {
  const txt = (s: string) => <span className={compact ? 'sr-only' : 'flex-1 truncate'}>{s}</span>
  return (
    <ul className="m-0 flex list-none flex-col gap-[2px] p-0">
      <li>
        <ExtLink href={`${DOCS_URL}/api`} arrow={false} className={footItem(compact)} title={compact ? 'Docs (opens in a new tab)' : undefined}>
          <BookOpen size={ICON} aria-hidden /> {txt('Docs ↗')}
        </ExtLink>
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
        <ExtLink href={SITE_URL} arrow={false} className={footItem(compact)} title={compact ? 'Gully Labs home (opens in a new tab)' : undefined} data-testid="home-link">
          <House size={ICON} aria-hidden /> {txt('gullylabs.xyz ↗')}
        </ExtLink>
      </li>
    </ul>
  )
}

/** Docs, Status and gullylabs.xyz as small icon buttons in the header (wide screens; the phone sheet lists them). */
function HeaderLinks({ health, onStatus }: { health: Health; onStatus: () => void }) {
  const btn = 'group/hl relative inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] text-muted transition-colors hover:bg-surface-hover hover:text-ink'
  const tip = (t: string) => (
    <span className="pointer-events-none absolute top-[calc(100%+6px)] left-1/2 z-50 -translate-x-1/2 rounded-[8px] border border-line-strong bg-surface-deep px-[10px] py-[5px] text-[12px] whitespace-nowrap text-ink opacity-0 transition-opacity group-hover/hl:opacity-100 group-focus-visible/hl:opacity-100" aria-hidden>
      {t}
    </span>
  )
  return (
    <div className="flex items-center gap-[2px]" data-testid="header-links">
      <ExtLink href={`${DOCS_URL}/api`} arrow={false} className={btn} aria-label="Docs (opens in a new tab)">
        <BookOpen size={ICON} aria-hidden />
        {tip('Docs ↗')}
      </ExtLink>
      <button type="button" onClick={onStatus} className={btn} aria-label={`Status: ${healthText[health]}`} data-testid="status-link" data-health={health}>
        <Activity size={ICON} aria-hidden />
        <span className={`absolute right-[7px] bottom-[7px] size-[7px] rounded-full border border-bg ${healthDot[health]}`} aria-hidden />
        {tip(`Status · ${healthText[health]}`)}
      </button>
      <ExtLink href={SITE_URL} arrow={false} className={btn} aria-label="Gully Labs home (opens in a new tab)" data-testid="home-link">
        <House size={ICON} aria-hidden />
        {tip('gullylabs.xyz ↗')}
      </ExtLink>
    </div>
  )
}

function Brand({ compact, onHome }: { compact: boolean; onHome: () => void }) {
  return (
    <button type="button" onClick={onHome} className={`flex min-h-11 min-w-0 items-center gap-[10px] text-ink ${compact ? 'justify-center' : ''}`} aria-label="Gully Labs App: overview" data-testid="app-brand">
      <Mascot size={24} decorative />
      {!compact && (
        <span className="flex min-w-0 items-center gap-2">
          <Wordmark height={18} />
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
      <div className="absolute inset-0 animate-[gl-fade_.2s_ease_both] bg-[rgba(4,6,12,.72)]" onClick={onClose} aria-hidden />
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
          <span className="font-mono text-[11px] tracking-[1px] text-faint">APP DASHBOARD</span>
          <button type="button" onClick={onClose} className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:text-ink" aria-label="Close menu">
            <X size={18} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ phone tab bar --- */

const TAB_BAR_IDS = ['overview', 'tracker', 'keys', 'alerts']

/** Under 860px: the four key pages as a bottom tab bar, plus "More" for the full menu sheet. */
function TabBar<T extends string>({ items, current, go, more, sheetOpen }: { items: NavItem<T>[]; current: T; go: (t: T) => void; more: () => void; sheetOpen: boolean }) {
  const tabs = TAB_BAR_IDS.map((id) => items.find((i) => i.id === id)).filter((x): x is NavItem<T> => !!x)
  const inMore = !tabs.some((t) => t.id === current)
  const cell = (on: boolean) => `relative flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-[3px] text-[11px] font-medium transition-colors ${on ? 'text-gold' : 'text-dim hover:text-ink'}`
  const bar = <span className="absolute top-0 left-1/2 h-[2px] w-8 -translate-x-1/2 rounded-full bg-gold" style={{ animation: 'gl-fade .25s ease both' }} aria-hidden />
  return (
    <nav aria-label="App sections" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-[rgba(13,20,28,.94)] pb-[env(safe-area-inset-bottom)] backdrop-blur-md print:hidden" data-testid="tab-bar">
      {tabs.map((t) => {
        const on = current === t.id
        return (
          <a
            key={t.id}
            href={`#${t.id}`}
            aria-current={on ? 'page' : undefined}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
              e.preventDefault()
              go(t.id)
            }}
            className={cell(on)}
          >
            {on && bar}
            {t.icon}
            <span className="max-w-full truncate px-1">{t.label}</span>
          </a>
        )
      })}
      <button type="button" onClick={more} aria-haspopup="dialog" aria-expanded={sheetOpen} className={cell(inMore)} data-testid="tab-more">
        {inMore && bar}
        <Ellipsis size={ICON} aria-hidden />
        <span>More</span>
      </button>
    </nav>
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
  const [statusOpen, setStatusOpen] = useState(false)
  const status = () => {
    setSheet(false)
    setStatusOpen(true)
  }
  const ws = me?.active.name ?? 'Your workspace'

  return (
    <div className="flex min-h-dvh" data-testid="app-shell" data-sidebar={narrow ? 'sheet' : compact ? 'icons' : 'open'}>
      {!narrow && (
        <aside aria-label="App" className={`sticky top-0 z-40 flex h-dvh shrink-0 flex-col gap-[6px] border-r border-line bg-bg-alt py-[6px] transition-[width] duration-200 print:hidden ${compact ? 'w-16 px-2' : 'w-[232px] px-3'}`} data-testid="app-sidebar">
          {/* The Gully mark (home), the workspace switcher and the collapse button share one row, so every page
              still fits the full-height list as the app grows (19 pages fit at 800 px). */}
          <div className={`flex items-center gap-1 ${compact ? 'flex-col' : ''}`}>
            <Brand compact onHome={() => go(first)} />
            <div className={compact ? 'w-full' : 'min-w-0 flex-1'}>
              <WorkspaceSwitcher compact={compact} onTeam={wallet.team} />
            </div>
            <button type="button" onClick={toggle} title={compact ? 'Expand sidebar' : 'Collapse to icons'} className="inline-flex size-8 relative after:absolute after:inset-x-0 after:-inset-y-[6px] shrink-0 items-center justify-center rounded-[10px] text-faint transition-colors hover:bg-surface-hover hover:text-ink" aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar to icons'} aria-expanded={!compact} data-testid="sidebar-toggle">
              {compact ? <ChevronsRight size={ICON} aria-hidden /> : <ChevronsLeft size={ICON} aria-hidden />}
            </button>
          </div>
          {/* One full-height list: it fits at 800px and up, so it scrolls only on short windows (and the icon
              rail never clips its tooltips). */}
          <nav aria-label="App pages" className={`-mx-1 min-h-0 flex-1 px-1 ${compact ? '' : 'overflow-y-auto [scrollbar-width:thin]'}`} data-testid="app-nav">
            <NavLinks items={items} current={current} go={go} compact={compact} dense />
          </nav>
          <div className="border-t border-line pt-[6px]">
            <WalletMenu onSignOut={onSignOut} go={wallet} compact={compact} placement="up" />
          </div>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-[rgba(13,20,28,.86)] backdrop-blur-md print:hidden">
          <div className="flex min-h-14 items-center gap-3 px-6 max-[480px]:px-4">
            {narrow && (
              <>
                <button ref={menuBtn} type="button" onClick={() => setSheet(true)} className="-ml-2 inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] text-ink hover:bg-surface-hover" aria-label="Open menu" aria-haspopup="dialog" aria-expanded={sheet} data-testid="menu-button">
                  <MenuIcon size={20} aria-hidden />
                </button>
                <ExtLink href={SITE_URL} arrow={false} className="inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] hover:bg-surface-hover" aria-label="Gully Labs home (opens in a new tab)" data-testid="home-link-header">
                  <Mascot size={24} decorative />
                </ExtLink>
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
            {!narrow && <HeaderLinks health={health} onStatus={status} />}
            <PlanPill account={account} />
            {narrow && <WalletMenu onSignOut={onSignOut} go={wallet} />}
          </div>
        </header>

        <div className={`flex min-w-0 flex-1 flex-col ${narrow ? 'pb-[calc(64px+env(safe-area-inset-bottom))]' : ''}`}>{children}</div>
      </div>

      {narrow && <TabBar items={items} current={current} go={pick} more={() => setSheet(true)} sheetOpen={sheet} />}

      {/* Gully AI everywhere in the app: the floating button (bottom right) and ⌘K / Ctrl+K. On the Gully AI
          page itself the chat is the page, so only the shortcut stays. */}
      <div className={`pointer-events-none fixed right-5 z-40 max-[600px]:right-4 print:hidden ${narrow ? 'bottom-[calc(76px+env(safe-area-inset-bottom))]' : 'bottom-5'}`} data-testid="corner-dock">
        <AskLauncher variant="floating" hideButton={current === ('ai' as T)} />
      </div>

      <StatusDialog open={statusOpen} onClose={() => setStatusOpen(false)} />

      <Sheet open={sheet} onClose={() => setSheet(false)}>
        <WorkspaceList onDone={() => setSheet(false)} />
        <nav aria-label="App pages">
          <NavLinks items={items} current={current} go={pick} compact={false} dense={false} />
        </nav>
        <div className="border-t border-line pt-2">
          <FooterLinks compact={false} health={health} onStatus={status} />
        </div>
      </Sheet>
    </div>
  )
}
