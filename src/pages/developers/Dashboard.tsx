import { BellRing, Boxes, ChartNoAxesCombined, CreditCard, History, KeyRound, LayoutDashboard, Settings, ShieldCheck, Store, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ActivityTab } from './Activity'
import { Alerts } from './Alerts'
import { AnalyticsPanel } from './Analytics'
import { type Account, type PlanId } from './api'
import { AppShell, type NavItem, type WalletGo } from './AppShell'
import { Billing, type CheckoutIntent } from './Billing'
import { InviteLanding } from './Invite'
import { KeysTab } from './Keys'
import { MerchantTab } from './merchant/MerchantTab'
import { Overview } from './Overview'
import { PortalReceipt } from './PortalReceipt'
import { APP_NAME, APP_TITLE, inviteTokenFromHash, usePortal } from './portal'
import { Products } from './Products'
import { SecurityTab } from './security/SecurityTab'
import { SettingsTab } from './Settings'
import { Team } from './Team'

/* The signed-in Gully Labs App (portal v2, app.gullylabs.xyz): the AppShell frame (sidebar with the
   workspace switcher, the pages, Docs, Gully AI, Status and the wallet menu; a slim header with the
   breadcrumb) around one page at a time. Pages are deep-linkable by hash (#keys, #alerts, #analytics,
   #billing, #products, #team, #activity, #settings; the pricing page links to #billing). Old hashes
   (#quickstart, #requests, #widget) open Keys at that section; #security-new, #security-reports and #security-review open Security there; #profile, #company and #sessions open
   Settings there. #invite=<token> shows the invite landing above the page; #receipt=<chain>:<tx> a
   printable receipt. A Merchant page, when it exists, goes between Billing and Team. */

export type Tab = 'overview' | 'products' | 'keys' | 'alerts' | 'analytics' | 'security' | 'billing' | 'merchant' | 'team' | 'activity' | 'settings'

const ICON = 16
const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  // The sidebar's pages, in order. A Merchant page (Store icon), when the merchant tab exists, goes after Billing.
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={ICON} aria-hidden /> },
  { id: 'products', label: 'Products', icon: <Boxes size={ICON} aria-hidden /> },
  { id: 'keys', label: 'Keys', icon: <KeyRound size={ICON} aria-hidden /> },
  { id: 'alerts', label: 'Alerts', icon: <BellRing size={ICON} aria-hidden /> },
  { id: 'analytics', label: 'Analytics', icon: <ChartNoAxesCombined size={ICON} aria-hidden /> },
  // Gully Security (security/SecurityTab.tsx). In the grouped sidebar (feat/app-services, services/nav.ts) it
  // belongs to the Services group: add 'security' to that group's ids when the two meet.
  { id: 'security', label: 'Security', icon: <ShieldCheck size={ICON} aria-hidden /> },
  { id: 'billing', label: 'Billing', icon: <CreditCard size={ICON} aria-hidden /> },
  { id: 'merchant', label: 'Merchant', icon: <Store size={ICON} aria-hidden /> },
  { id: 'team', label: 'Team', icon: <Users size={ICON} aria-hidden /> },
  { id: 'activity', label: 'Activity', icon: <History size={ICON} aria-hidden /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={ICON} aria-hidden /> },
]
const LEGACY: Record<string, Tab> = { quickstart: 'keys', requests: 'keys', widget: 'keys', profile: 'settings', company: 'settings', sessions: 'settings', 'security-new': 'security', 'security-reports': 'security', 'security-monitors': 'security', 'security-review': 'security' }

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

/** `?alert=<chain>:<TICKER>` with #alerts (the stock pages' "Set an alert" links): that stock, or null. */
function alertFromUrl(): string | null {
  if (window.location.hash !== '#alerts') return null
  const v = new URLSearchParams(window.location.search).get('alert') ?? ''
  const m = v.match(/^([a-z]{2,12}):([A-Za-z.]{1,8})$/)
  return m ? `${m[1]}:${m[2].toUpperCase()}` : null
}

/** `&pct=<n>&dir=above|below|both` beside ?alert= (Gully AI's "Set an alert at 2% above"): the gap the
    New gap alert dialog opens with. The user still saves it themselves. */
function alertGapFromUrl(): { pct: string; dir: 'above' | 'below' | 'both' } | null {
  if (window.location.hash !== '#alerts') return null
  const q = new URLSearchParams(window.location.search)
  const pct = Number(q.get('pct'))
  const dir = q.get('dir')
  if (!Number.isFinite(pct) || pct <= 0 || pct > 50) return null
  return { pct: String(pct), dir: dir === 'above' || dir === 'below' ? dir : 'both' }
}

export function Dashboard({ account, reload, onSignOut }: { account: Account; reload: () => Promise<void>; onSignOut: () => void }) {
  const [view, setTab, reread] = useView()
  const { tab, section } = view
  const { me } = usePortal()
  const [intent, setIntent] = useState<CheckoutIntent>(null)
  const [newKey, setNewKey] = useState(false)
  // Arriving from a stock page opens the New gap alert dialog with that stock chosen.
  const [alertFor, setAlertFor] = useState(alertFromUrl)
  const [alertGap] = useState(alertGapFromUrl)
  const [newAlert, setNewAlert] = useState(() => alertFor !== null)
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('alert')) return
    const q = new URLSearchParams(window.location.search)
    q.delete('alert')
    q.delete('pct')
    q.delete('dir')
    history.replaceState(null, '', window.location.pathname + (q.size ? `?${q}` : '') + window.location.hash)
  }, [])

  const clearIntent = useCallback(() => setIntent(null), [])
  const clearNewKey = useCallback(() => setNewKey(false), [])
  const clearNewAlert = useCallback(() => {
    setNewAlert(false)
    setAlertFor(null)
  }, [])
  const go = useCallback(
    (t: Tab, s: string | null = null) => {
      setTab(t, s)
      if (!s) window.scrollTo({ top: 0, behavior: 'instant' })
    },
    [setTab],
  )
  const goTab = useCallback((t: Tab) => go(t), [go])
  const wallet: WalletGo = useMemo(
    () => ({ profile: () => go('settings', 'profile'), team: () => go('team'), activity: () => go('activity'), sessions: () => go('settings', 'sessions'), invites: () => go('overview') }),
    [go],
  )

  const liveKeys = account.keys.filter((k) => !k.revokedAt).length
  const items: NavItem<Tab>[] = useMemo(
    () => TABS.map((t) => (t.id === 'keys' ? { ...t, badge: <span className="rounded-full bg-surface-deep px-[6px] font-mono text-[11px] text-faint">{liveKeys}</span> } : t)),
    [liveKeys],
  )
  const page = TABS.find((t) => t.id === tab)?.label ?? 'Overview'

  // The tab title names the page: "Billing · Gully Labs App"; the home page carries the app's full title.
  useEffect(() => {
    document.title = tab === 'overview' ? APP_TITLE : `${page} · ${APP_NAME}`
  }, [tab, page])

  if (view.receipt) return <PortalReceipt id={view.receipt} onBack={() => go('billing')} />

  const wsKey = me?.active.id ?? account.address
  return (
    <AppShell items={items} current={tab} go={goTab} account={account} pageLabel={page} wallet={wallet} onSignOut={onSignOut}>
      {view.invite && (
        <div className="mx-auto w-full max-w-[1240px] px-6 pt-5 max-[480px]:px-4">
          <InviteLanding token={view.invite} signedIn onDone={reread} />
        </div>
      )}

      <main key={`${wsKey}:${tab}`} id={`panel-${tab}`} aria-label={page} tabIndex={-1} data-focus-fallback data-testid="app-page" data-page={tab} className="mx-auto min-h-[60vh] w-full max-w-[1240px] animate-[gl-rise_.3s_cubic-bezier(.2,.8,.2,1)_both] px-6 pt-5 pb-16 outline-none max-[480px]:px-4">
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
        {tab === 'alerts' && <Alerts goBilling={() => go('billing')} creating={newAlert} onCreateDone={clearNewAlert} prefill={alertFor} prefillGap={alertGap} />}
        {tab === 'analytics' && <AnalyticsPanel />}
        {tab === 'security' && <SecurityTab section={section} />}
        {tab === 'billing' && <Billing account={account} reload={reload} intent={intent} onIntentDone={clearIntent} />}
        {tab === 'merchant' && <MerchantTab />}
        {tab === 'team' && <Team />}
        {tab === 'activity' && <ActivityTab />}
        {tab === 'settings' && <SettingsTab section={section} />}
      </main>
    </AppShell>
  )
}
