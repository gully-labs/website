import { ArrowUpRight, ShieldCheck, Store } from 'lucide-react'
import { securityPrimary } from '../../site-host'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ActivityTab } from './Activity'
import { AnalyticsPanel } from './Analytics'
import { type Account, type PlanId } from './api'
import { AppShell, type NavItem, type WalletGo } from './AppShell'
import { Billing, type CheckoutIntent } from './Billing'
import { ChainsTab } from './Chains'
import { InviteLanding } from './Invite'
import { IpfsTab } from './Ipfs'
import { KeysTab } from './Keys'
import { MerchantTab } from './merchant/MerchantTab'
import { Overview } from './Overview'
import { PortalReceipt } from './PortalReceipt'
import { APP_NAME, APP_TITLE, inviteTokenFromHash, usePortal } from './portal'
import { ServicesTab } from './Services'
import { AI_TAB, HANDOFF_TABS, isHandoffTab, isRemovedTab, leavingFor, LEGACY_CHAIN_HASHES, redirectFor, REMOVED_TABS, SIDEBAR, type HandoffTab, type RemovedTab, type SidebarTab } from './services/nav'
import { SecurityTab } from './security/SecurityTab'
import { SettingsTab } from './Settings'
import { Team } from './Team'
import { openAsk } from '../../components/ask/openAsk'
import { pillSm } from './styles'

/* The signed-in Gully Labs App (app.gullylabs.xyz): the AppShell frame (a ten-item sidebar with the workspace
   switcher and the wallet menu; a slim header with the breadcrumb; Gully AI as a floating assistant on every page)
   around one page at a time. Only the services Gully Labs itself offers are pages here (owner, 2026-11-08); the
   other Gully products are on the web (gullylabs.xyz/products) and in their own apps.

   Pages are deep-linkable by hash. The sidebar's ten: #overview (the home), #activity, #chains, #ipfs, #analytics,
   #services, #keys, #billing, #team, #settings. Old hashes (#quickstart, #requests, #widget) open Keys at that
   section; #security-new, #security-reports and #security-review open Security there; #profile, #company and
   #sessions open Settings there. #invite=<token> shows the invite landing above the page; #receipt=<chain>:<tx> a
   printable receipt. #ai opens the Gully AI drawer over the Overview.

   Hashes that leave (services/nav.ts redirectFor): the pages this app no longer has (#products, #tracker, #alerts,
   #score, #widgets, #telegram) go to the page on the web where the feature lives now; a product hash (#chain, #pay,
   #rpc, #holders, #security, #studio, and the old #chains/launch, #chain-kit, #deepcore) goes to the product's own
   app. What was built here before the products moved stays reachable by hash, without a sidebar entry: a merchant
   store (#merchant, from Gully Pay; Billing points at it) and, once Gully Security is its own app
   (SECURITY_PRIMARY), the scans and monitors made here (#scans). */

export type Tab = SidebarTab | 'merchant' | 'scans'

const ICON = 16
const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  // The sidebar's ten pages, in order (services/nav.ts SIDEBAR) ...
  ...SIDEBAR.map((s) => ({ id: s.id, label: s.label, icon: <s.icon size={ICON} aria-hidden /> })),
  // ... and the two pages without a sidebar entry: what Gully Pay and Gully Security left behind.
  { id: 'merchant', label: 'Merchant store', icon: <Store size={ICON} aria-hidden /> },
  { id: 'scans', label: 'Security scans', icon: <ShieldCheck size={ICON} aria-hidden /> },
]
const SIDEBAR_IDS = new Set<string>(SIDEBAR.map((s) => s.id))
// Old hashes: Keys and Settings sections, Security's sections, and the Gully Chain features that moved to gullychain.xyz.
const LEGACY: Record<string, AppTab> = { quickstart: 'keys', requests: 'keys', widget: 'keys', profile: 'settings', company: 'settings', sessions: 'settings', 'security-new': 'security', 'security-reports': 'security', 'security-monitors': 'security', 'security-review': 'security', ...Object.fromEntries(LEGACY_CHAIN_HASHES.map((h) => [h, 'chain'])) }

/** Every page: the tabs above plus the hashes that leave (services/nav.ts) and the old Gully AI page. */
type AppTab = Tab | RemovedTab | HandoffTab | typeof AI_TAB.id
const ALL_TABS: { id: AppTab; label: string; icon: ReactNode }[] = [...TABS, ...[...REMOVED_TABS, AI_TAB, ...HANDOFF_TABS].map((s) => ({ id: s.id, label: s.label, icon: <s.icon size={ICON} aria-hidden /> }))]

type View = { tab: AppTab; section: string | null; receipt: string | null; invite: string | null }

function readHash(): View {
  const h = window.location.hash.slice(1)
  const none = { section: null, receipt: null, invite: null }
  if (ALL_TABS.some((t) => t.id === h)) return { tab: h as AppTab, ...none }
  // The Merchant tab's old section anchors (#m-wallets, from earlier pay-page links): its sub-tab now.
  const m = h.match(/^m-(payments|links|invoices|wallets|profile|fees|webhooks)$/)
  if (m) {
    history.replaceState(null, '', `#merchant/${m[1]}`)
    return { tab: 'merchant', ...none }
  }
  // #<page>/<sub-tab> (e.g. #merchant/links): the page; the page's own useSubTab reads the rest.
  const page = h.split('/')[0]
  if (h.includes('/') && LEGACY[h]) return { tab: LEGACY[h], ...none, section: h }
  if (h.includes('/') && ALL_TABS.some((t) => t.id === page)) return { tab: page as AppTab, ...none }
  if (LEGACY[h]) return { tab: LEGACY[h], ...none, section: h }
  const r = h.match(/^receipt=(\d{1,10}:0x[0-9a-fA-F]{64})$/)
  if (r) return { tab: 'billing', ...none, receipt: r[1] }
  return { tab: 'overview', ...none, invite: inviteTokenFromHash() }
}

function useView(): [View, (t: AppTab, section?: string | null) => void, () => void] {
  const [state, setState] = useState(readHash)
  useEffect(() => {
    const on = () => setState(readHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const set = useCallback((t: AppTab, section: string | null = null) => {
    history.replaceState(null, '', t === 'overview' ? window.location.pathname + window.location.search : `#${section ?? t}`)
    setState({ tab: t, section, receipt: null, invite: null })
  }, [])
  const reread = useCallback(() => setState(readHash()), [])
  return [state, set, reread]
}

/** A hash that left the app: the browser goes to the page where the feature lives now, at once (replace, so Back
    does not bounce); this line shows meanwhile (and is the way on when the browser blocks the navigation). */
function Leaving({ tab }: { tab: RemovedTab | HandoffTab }) {
  const h = leavingFor(tab)!
  useEffect(() => {
    window.location.replace(h.href)
  }, [h.href])
  const product = isHandoffTab(tab)
  return (
    <div className="flex flex-col items-start gap-3 py-6" data-testid="product-redirect" data-product={tab} data-href={h.href}>
      <p className="m-0 text-[14px] text-muted">
        {product ? `${h.label} lives in its own app now.` : `${h.label} is on the web now.`} Opening <span className="font-mono text-ink">{h.href.replace(/^https:\/\//, '').replace(/\/$/, '')}</span>…
      </p>
      <a href={h.href} className={pillSm} rel="noopener">
        Open {h.label} <ArrowUpRight size={14} aria-hidden />
      </a>
    </div>
  )
}

export function Dashboard({ account, reload, onSignOut }: { account: Account; reload: () => Promise<void>; onSignOut: () => void }) {
  const [view, setTab, reread] = useView()
  const { tab, section } = view
  const { me } = usePortal()
  const [intent, setIntent] = useState<CheckoutIntent>(null)
  const [newKey, setNewKey] = useState(false)

  const clearIntent = useCallback(() => setIntent(null), [])
  const clearNewKey = useCallback(() => setNewKey(false), [])
  const go = useCallback(
    (t: AppTab, s: string | null = null) => {
      setTab(t, s)
      if (!s) window.scrollTo({ top: 0, behavior: 'instant' })
    },
    [setTab],
  )
  const goTab = useCallback((t: AppTab) => go(t), [go])
  const wallet: WalletGo = useMemo(
    () => ({ profile: () => go('settings', 'profile'), team: () => go('team'), activity: () => go('activity'), sessions: () => go('settings', 'sessions'), invites: () => go('overview') }),
    [go],
  )

  // #ai (the old Gully AI page): the Overview with the Gully AI drawer open.
  useEffect(() => {
    if (tab !== AI_TAB.id) return
    go('overview')
    openAsk()
  }, [tab, go])

  const liveKeys = account.keys.filter((k) => !k.revokedAt).length
  // The sidebar: the ten pages as one flat list (Keys carries its live-key count).
  const items: NavItem<AppTab>[] = useMemo(
    () => ALL_TABS.filter((t) => SIDEBAR_IDS.has(t.id)).map((t) => (t.id === 'keys' && liveKeys > 0 ? { ...t, badge: <span className="rounded-full bg-surface-deep px-[6px] font-mono text-[11px] text-faint">{liveKeys}</span> } : t)),
    [liveKeys],
  )
  const page = ALL_TABS.find((t) => t.id === tab)?.label ?? 'Overview'

  // The tab title names the page: "Billing · Gully Labs App"; the home page carries the app's full title.
  useEffect(() => {
    document.title = tab === 'overview' ? APP_TITLE : `${page} · ${APP_NAME}`
  }, [tab, page])

  if (view.receipt) return <PortalReceipt id={view.receipt} onBack={() => go('billing')} />

  // Gully Security stays a page here until gullysecurity.xyz is its home (SECURITY_PRIMARY); every other product hash
  // and every removed page leaves.
  const leaving = (isRemovedTab(tab) || (isHandoffTab(tab) && !(tab === 'security' && !securityPrimary()))) && redirectFor(tab) !== null
  const wsKey = me?.active.id ?? account.address
  return (
    <AppShell items={items} current={tab} go={goTab} account={account} pageLabel={page} wallet={wallet} onSignOut={onSignOut}>
      {view.invite && (
        <div className="mx-auto w-full max-w-[1240px] px-6 pt-5 max-[480px]:px-4">
          <InviteLanding token={view.invite} signedIn onDone={reread} />
        </div>
      )}

      <main key={`${wsKey}:${tab}`} id={`panel-${tab}`} aria-label={page} tabIndex={-1} data-focus-fallback data-testid="app-page" data-page={tab} className="mx-auto min-h-[60vh] w-full max-w-[1240px] animate-[gl-rise_.3s_cubic-bezier(.2,.8,.2,1)_both] px-6 pt-3 pb-6 outline-none max-[480px]:px-4">
        {tab === 'overview' && (
          <Overview
            account={account}
            go={go}
            createKey={() => {
              setNewKey(true)
              go('keys')
            }}
            checkout={(plan: PlanId, asset: string | null) => {
              setIntent({ plan, asset })
              go('billing')
            }}
          />
        )}
        {tab === 'chains' && <ChainsTab />}
        {tab === 'ipfs' && <IpfsTab />}
        {tab === 'services' && <ServicesTab account={account} />}
        {tab === 'keys' && <KeysTab account={account} reload={reload} creating={newKey} onCreateDone={clearNewKey} section={section} />}
        {tab === 'analytics' && <AnalyticsPanel />}
        {tab === 'security' && !securityPrimary() && <SecurityTab section={section} />}
        {tab === 'scans' && <SecurityTab section={section} />}
        {tab === 'billing' && <Billing account={account} reload={reload} intent={intent} onIntentDone={clearIntent} />}
        {tab === 'merchant' && <MerchantTab />}
        {tab === 'team' && <Team />}
        {tab === 'activity' && <ActivityTab />}
        {tab === 'settings' && <SettingsTab section={section} />}
        {leaving && <Leaving tab={tab as RemovedTab | HandoffTab} />}
      </main>
    </AppShell>
  )
}
