import { BellRing, BookOpen, Bot, Boxes, Building2, ChartCandlestick, ChartNoAxesCombined, Check, ChevronsUpDown, Copy, CreditCard, History, House, KeyRound, LayoutDashboard, LogOut, Mail, Settings, ShieldCheck, UserRound, Users } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { VenueLogo } from '../../components/logos/VenueLogo'
import { Wordmark } from '../../components/Wordmark'
import { copyWithToast } from '../../components/ui/toast'
import { DOCS_URL, isLocalHost, SITE_URL } from '../../site-host'
import { ActivityTab } from './Activity'
import { Alerts } from './Alerts'
import { AnalyticsPanel } from './Analytics'
import { daysLeft, shortAddress, type Account, type PlanId, type Role } from './api'
import { Avatar } from './Avatar'
import { Billing, type CheckoutIntent } from './Billing'
import { InviteLanding } from './Invite'
import { KeysTab } from './Keys'
import { Menu, menuItem } from './Menu'
import { Overview } from './Overview'
import { PortalReceipt } from './PortalReceipt'
import { declinedInvites, inviteTokenFromHash, usePortal } from './portal'
import { Products } from './Products'
import { SettingsTab } from './Settings'
import { Team } from './Team'

/* The signed-in console ("B · Console app", portal v2): a header with the Gully Labs wordmark, the
   workspace switcher (name, your role, every workspace you belong to), the plan pill, links home, to
   the Tracker, Gully AI and the docs, and the wallet menu (Profile, Team, Activity, Sessions, Sign
   out; a dot when invites wait). Then underlined tabs with icons, deep-linkable by hash (#keys,
   #alerts, #analytics, #billing, #products, #team, #activity, #settings; the pricing page links to
   #billing), working as an ARIA tablist (arrow keys, Home, End). Old hashes (#quickstart, #requests,
   #widget) open Keys at that section; #profile, #company and #sessions open Settings there.
   #invite=<token> shows the invite landing above the tabs; #receipt=<chain>:<tx> a printable receipt. */

export type Tab = 'overview' | 'products' | 'keys' | 'alerts' | 'analytics' | 'billing' | 'team' | 'activity' | 'settings'

const ICON = 16
const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={ICON} aria-hidden /> },
  { id: 'products', label: 'Products', icon: <Boxes size={ICON} aria-hidden /> },
  { id: 'keys', label: 'Keys', icon: <KeyRound size={ICON} aria-hidden /> },
  { id: 'alerts', label: 'Alerts', icon: <BellRing size={ICON} aria-hidden /> },
  { id: 'analytics', label: 'Analytics', icon: <ChartNoAxesCombined size={ICON} aria-hidden /> },
  { id: 'billing', label: 'Billing', icon: <CreditCard size={ICON} aria-hidden /> },
  { id: 'team', label: 'Team', icon: <Users size={ICON} aria-hidden /> },
  { id: 'activity', label: 'Activity', icon: <History size={ICON} aria-hidden /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={ICON} aria-hidden /> },
]
const LEGACY: Record<string, Tab> = { quickstart: 'keys', requests: 'keys', widget: 'keys', profile: 'settings', company: 'settings', sessions: 'settings', merchant: 'products' }

type View = { tab: Tab; section: string | null; receipt: string | null; invite: string | null }

function readHash(): View {
  const h = window.location.hash.slice(1)
  const none = { section: null, receipt: null, invite: null }
  if (TABS.some((t) => t.id === h)) return { tab: h as Tab, ...none }
  if (LEGACY[h]) return { tab: LEGACY[h], ...none, section: h }
  const r = h.match(/^receipt=(\d{1,10}:0x[0-9a-fA-F]{64})$/)
  if (r) return { tab: 'billing', ...none, receipt: r[1] }
  return { tab: 'overview', ...none, invite: inviteTokenFromHash() }
}

function useView(): [View, (t: Tab, section?: string | null) => void, () => void] {
  const [state, setState] = useState(readHash)
  useEffect(() => {
    const on = () => setState(readHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const set = useCallback((t: Tab, section: string | null = null) => {
    history.replaceState(null, '', t === 'overview' ? window.location.pathname + window.location.search : `#${section ?? t}`)
    setState({ tab: t, section, receipt: null, invite: null })
  }, [])
  const reread = useCallback(() => setState(readHash()), [])
  return [state, set, reread]
}

const site = (path: string) => (isLocalHost() ? path : `${SITE_URL}${path}`)
const roleTone = (r: Role) => (r === 'owner' ? 'border-gold text-gold' : r === 'admin' ? 'border-gold-line text-gold' : 'border-line-strong text-muted')

function WorkspaceSwitcher({ go }: { go: (t: Tab) => void }) {
  const { me, role, switchTo } = usePortal()
  if (!me) return null
  const active = me.active
  return (
    <Menu
      label={`Workspace: ${active.name}, you are ${role}. Switch workspace`}
      testId="workspace-switcher"
      align="left"
      width={300}
      buttonClass="flex min-h-11 max-w-[min(320px,calc(100vw-120px))] items-center gap-2 rounded-full border border-line-strong bg-surface px-3 text-[13px] text-ink transition-colors hover:border-line-hover"
      button={
        <>
          <Building2 size={ICON} className="shrink-0 text-gold" aria-hidden />
          <span className="truncate font-medium">{active.name}</span>
          <span className={`shrink-0 rounded-full border px-[6px] font-mono text-[10px] ${roleTone(role)}`}>{role}</span>
          <ChevronsUpDown size={14} className="shrink-0 text-faint" aria-hidden />
        </>
      }
    >
      {(close) => (
        <>
          <span className="px-3 pt-2 pb-1 font-mono text-[10.5px] tracking-[1px] text-faint">WORKSPACES</span>
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
                <span className="font-mono text-[10.5px] text-faint">{w.id === me.address ? 'yours' : `owner ${shortAddress(w.owner)}`}</span>
              </span>
              <span className={`rounded-full border px-[6px] font-mono text-[10px] ${roleTone(w.role)}`}>{w.role}</span>
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
              go('team')
            }}
          >
            <Users size={ICON} aria-hidden /> Team and invites
          </button>
        </>
      )}
    </Menu>
  )
}

function WalletMenu({ onSignOut, go }: { onSignOut: () => void; go: (t: Tab, section?: string | null) => void }) {
  const { me, user } = usePortal()
  const address = me?.address ?? user
  const pending = (me?.pendingInvites ?? []).filter((i) => !declinedInvites()[i.id]).length
  const label = me?.profile.displayName ?? me?.profile.ens ?? shortAddress(address)
  const item = (icon: ReactNode, text: string, onClick: () => void, extra = '') => ({ icon, text, onClick, extra })
  return (
    <Menu
      label={`Wallet ${address}${pending ? `, ${pending} invite${pending === 1 ? '' : 's'} waiting` : ''}`}
      testId="wallet-menu"
      width={250}
      buttonClass="relative flex min-h-11 items-center gap-2 rounded-full border border-line-strong bg-surface px-2 pr-3 font-mono text-[12px] text-ink transition-colors hover:border-line-hover"
      button={
        <>
          <Avatar address={address} src={me?.profile.avatar} size={24} />
          <span className="max-w-[120px] truncate max-[420px]:hidden">{label}</span>
          {pending > 0 && <span className="absolute -top-[2px] -right-[2px] size-[10px] rounded-full border-2 border-bg bg-gold" aria-hidden data-testid="invite-dot" />}
        </>
      }
    >
      {(close) => (
        <>
          <span className="px-3 pt-2 font-mono text-[10.5px] break-all text-faint">{address}</span>
          <span className="px-3 pb-2 text-[11px] text-faint">{me?.profile.ens ? `${me.profile.ens} · ` : ''}signed in with this wallet (SIWE)</span>
          {[
            ...(pending ? [item(<Mail size={ICON} aria-hidden />, `${pending} invite${pending === 1 ? '' : 's'} waiting`, () => go('overview'), 'text-gold')] : []),
            item(<UserRound size={ICON} aria-hidden />, 'Profile', () => go('settings', 'profile')),
            item(<Users size={ICON} aria-hidden />, 'Team', () => go('team')),
            item(<History size={ICON} aria-hidden />, 'Activity', () => go('activity')),
            item(<ShieldCheck size={ICON} aria-hidden />, 'Sessions', () => go('settings', 'sessions')),
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
    <span className="flex min-h-[30px] items-center gap-2 rounded-full border border-line px-[10px] text-[13px] whitespace-nowrap" title={account.plan.expiresAt ? `Runs until ${new Date(account.plan.expiresAt).toLocaleString()}` : undefined}>
      <span className="size-2 rounded-full" style={{ background: !paid ? '#6c7888' : soon ? '#ff8a7a' : '#e8c060' }} aria-hidden />
      {account.plan.name} plan
      {left !== null && <span className={soon ? 'text-error' : 'text-muted'}>· {left === 0 ? 'ends today' : `${left} day${left === 1 ? '' : 's'} left`}</span>}
    </span>
  )
}

const navLink = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-[6px] rounded-full px-3 text-[13px] text-muted hover:text-ink'

export function Dashboard({ account, reload, onSignOut }: { account: Account; reload: () => Promise<void>; onSignOut: () => void }) {
  const [view, setTab, reread] = useView()
  const { tab, section } = view
  const { me } = usePortal()
  const [intent, setIntent] = useState<CheckoutIntent>(null)
  const [newKey, setNewKey] = useState(false)
  const [newAlert, setNewAlert] = useState(false)
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const navRef = useRef<HTMLDivElement>(null)

  // On narrow screens the tabs scroll sideways: keep the current one in view (e.g. arriving at #billing).
  useEffect(() => {
    const el = tabRefs.current[tab]
    const nav = navRef.current
    if (el && nav && nav.scrollWidth > nav.clientWidth) nav.scrollLeft += el.getBoundingClientRect().left - nav.getBoundingClientRect().left - 16
  }, [tab])

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === tab)
    let next = -1
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TABS.length - 1
    if (next < 0) return
    e.preventDefault()
    setTab(TABS[next].id)
    tabRefs.current[TABS[next].id]?.focus()
  }

  const clearIntent = useCallback(() => setIntent(null), [])
  const clearNewKey = useCallback(() => setNewKey(false), [])
  const clearNewAlert = useCallback(() => setNewAlert(false), [])
  const go = useCallback(
    (t: Tab, s: string | null = null) => {
      setTab(t, s)
      if (!s) window.scrollTo({ top: 0, behavior: 'instant' })
    },
    [setTab],
  )

  if (view.receipt) return <PortalReceipt id={view.receipt} onBack={() => go('billing')} />

  const wsKey = me?.active.id ?? account.address
  return (
    <div className="flex flex-col">
      <header className="border-b border-line print:hidden">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-[10px] px-6 pt-3 max-[480px]:px-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <button type="button" onClick={() => go('overview')} className="flex min-h-11 items-center gap-[10px] text-ink" aria-label="Gully Labs Developers: overview">
              <VenueLogo venue="gully" name="Gully Labs" size={24} decorative />
              <Wordmark size={20} />
              <span className="font-semibold text-muted max-[420px]:hidden">Developers</span>
            </button>
            <span className="ml-auto flex items-center gap-1">
              <a href={SITE_URL} className={navLink} aria-label="Gully Labs home" data-testid="home-link">
                <House size={ICON} aria-hidden /> <span className="max-[560px]:hidden">Home</span>
              </a>
              <a href={site('/tracker')} className={navLink} aria-label="Tracker">
                <ChartCandlestick size={ICON} aria-hidden /> <span className="max-[760px]:hidden">Tracker</span>
              </a>
              <a href={site('/ask')} className={navLink} aria-label="Gully AI">
                <Bot size={ICON} aria-hidden /> <span className="max-[760px]:hidden">Gully AI</span>
              </a>
              <a href={`${DOCS_URL}/api`} target="_blank" rel="noopener noreferrer" className={navLink} aria-label="Docs (opens in a new tab)">
                <BookOpen size={ICON} aria-hidden /> <span className="max-[760px]:hidden">Docs ↗</span>
              </a>
              <WalletMenu onSignOut={onSignOut} go={go} />
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <WorkspaceSwitcher go={go} />
            <PlanPill account={account} />
          </div>
          <div ref={navRef} role="tablist" aria-label="Portal" onKeyDown={onTabKey} className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]">
            {TABS.map((t) => {
              const on = tab === t.id
              return (
                <button
                  key={t.id}
                  ref={(el) => {
                    tabRefs.current[t.id] = el
                  }}
                  id={`tab-${t.id}`}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-controls={`panel-${t.id}`}
                  tabIndex={on ? 0 : -1}
                  onClick={() => setTab(t.id)}
                  className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-[12px] font-medium whitespace-nowrap transition-colors -outline-offset-2 ${on ? 'border-gold text-ink' : 'border-transparent text-dim hover:text-ink'}`}
                >
                  <span className={on ? 'text-gold' : ''}>{t.icon}</span>
                  {t.label}
                  {t.id === 'keys' && <span className="rounded-full bg-surface-deep px-[6px] font-mono text-[11px] text-faint">{account.keys.filter((k) => !k.revokedAt).length}</span>}
                </button>
              )
            })}
          </div>
        </div>
      </header>

      {view.invite && (
        <div className="mx-auto w-full max-w-[1240px] px-6 pt-5 max-[480px]:px-4">
          <InviteLanding token={view.invite} signedIn onDone={reread} />
        </div>
      )}

      <div key={`${wsKey}:${tab}`} id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={-1} className="mx-auto min-h-[60vh] w-full max-w-[1240px] animate-[gl-rise_.3s_cubic-bezier(.2,.8,.2,1)_both] px-6 pt-5 pb-16 outline-none max-[480px]:px-4">
        {tab === 'overview' && (
          <Overview
            account={account}
            go={go}
            createKey={() => {
              setNewKey(true)
              go('keys')
            }}
            createAlert={() => {
              setNewAlert(true)
              go('alerts')
            }}
            checkout={(plan: PlanId, asset: string | null) => {
              setIntent({ plan, asset })
              go('billing')
            }}
          />
        )}
        {tab === 'products' && <Products account={account} go={go} />}
        {tab === 'keys' && <KeysTab account={account} reload={reload} creating={newKey} onCreateDone={clearNewKey} section={section} />}
        {tab === 'alerts' && <Alerts goBilling={() => go('billing')} creating={newAlert} onCreateDone={clearNewAlert} />}
        {tab === 'analytics' && <AnalyticsPanel />}
        {tab === 'billing' && <Billing account={account} reload={reload} intent={intent} onIntentDone={clearIntent} />}
        {tab === 'team' && <Team />}
        {tab === 'activity' && <ActivityTab />}
        {tab === 'settings' && <SettingsTab section={section} />}
      </div>
    </div>
  )
}
