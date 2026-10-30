import { BellRing, Boxes, ChartNoAxesCombined, CreditCard, History, KeyRound, LayoutDashboard, Settings, ShieldCheck, Store, Users } from 'lucide-react'
import { ProductHandoff, type HandoffCopy } from '../../console/Handoff'
import { Btn } from '../../console/ui'
import { securityPrimary } from '../../site-host'
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
import { grouped, HANDOFF_TABS, isHandoffTab, isServiceTab, SERVICE_TABS, type HandoffTab, type ServiceTab } from './services/nav'
import { ServiceView } from './services/ServiceView'
import { SecurityTab } from './security/SecurityTab'
import { SettingsTab } from './Settings'
import { Team } from './Team'

/* The signed-in Gully Labs App (portal v2, app.gullylabs.xyz): the AppShell frame (sidebar with the
   workspace switcher, the pages, Docs, Gully AI, Status and the wallet menu; a slim header with the
   breadcrumb) around one page at a time. Pages are deep-linkable by hash (#keys, #alerts, #analytics,
   #billing, #products, #team, #activity, #settings; the pricing page links to #billing). Old hashes
   (#quickstart, #requests, #widget) open Keys at that section; #security-new, #security-reports and #security-review open Security there; #profile, #company and #sessions open
   Settings there. #invite=<token> shows the invite landing above the page; #receipt=<chain>:<tx> a
   printable receipt.

   Products on their own domains (2026-10-26): the "Gully products" group hands off to each product's domain
   (services/nav.ts HANDOFF_TABS, console/Handoff.tsx). What was built here before the move stays reachable from its
   hand-off without a sidebar entry: a merchant store (#merchant, from Gully Pay) and, once Gully Security is its own
   app (SECURITY_PRIMARY), the scans and monitors made here (#scans, from Gully Security). */

export type Tab = 'overview' | 'products' | 'keys' | 'alerts' | 'analytics' | 'billing' | 'merchant' | 'scans' | 'team' | 'activity' | 'settings'

const ICON = 16
const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  // The sidebar's pages, in order. A Merchant page (Store icon), when the merchant tab exists, goes after Billing.
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={ICON} aria-hidden /> },
  { id: 'products', label: 'Products', icon: <Boxes size={ICON} aria-hidden /> },
  { id: 'keys', label: 'Keys', icon: <KeyRound size={ICON} aria-hidden /> },
  { id: 'alerts', label: 'Alerts', icon: <BellRing size={ICON} aria-hidden /> },
  { id: 'analytics', label: 'Analytics', icon: <ChartNoAxesCombined size={ICON} aria-hidden /> },
  { id: 'billing', label: 'Billing', icon: <CreditCard size={ICON} aria-hidden /> },
  // Kept from before Gully Pay and Gully Security moved out; opened from their hand-offs, not listed in the sidebar.
  { id: 'merchant', label: 'Merchant store', icon: <Store size={ICON} aria-hidden /> },
  { id: 'scans', label: 'Security scans', icon: <ShieldCheck size={ICON} aria-hidden /> },
  { id: 'team', label: 'Team', icon: <Users size={ICON} aria-hidden /> },
  { id: 'activity', label: 'Activity', icon: <History size={ICON} aria-hidden /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={ICON} aria-hidden /> },
]
const HIDDEN = new Set<string>(['merchant', 'scans'])
// Old hashes: Keys and Settings sections, Security's sections, and the Gully Chain features that moved to gullychain.xyz.
const LEGACY: Record<string, AppTab> = { quickstart: 'keys', requests: 'keys', widget: 'keys', profile: 'settings', company: 'settings', sessions: 'settings', 'security-new': 'security', 'security-reports': 'security', 'security-monitors': 'security', 'security-review': 'security', chains: 'chain', 'chains/launch': 'chain', 'chain-kit': 'chain', deepcore: 'chain' }

/** Every page: the tabs above plus the service pages and the product hand-offs (services/nav.ts), each with its icon. */
type AppTab = Tab | ServiceTab | HandoffTab
const ALL_TABS: { id: AppTab; label: string; icon: ReactNode }[] = [...TABS, ...[...SERVICE_TABS, ...HANDOFF_TABS].map((s) => ({ id: s.id, label: s.label, icon: <s.icon size={ICON} aria-hidden /> }))]

/** What each hand-off says; `go` opens what stays here (alerts, a store or scans made before the move). */
function handoffCopy(id: HandoffTab, go: (t: AppTab) => void): HandoffCopy {
  const here = (label: string, t: AppTab) => (
    <Btn kind="ter" size="xs" onClick={() => go(t)}>
      {label}
    </Btn>
  )
  switch (id) {
    case 'chain':
      return { line: <>Testnet 485590 is open: <b>Gully Street</b> (launchpad, Gully Swap, .gully names, Quests, Arcade, copy trading, referrals), the explorer, faucet and bridge. Gully Core is its launchpad and DEX core, and your own chain launches from Gully Chain&apos;s app too.</>, href: 'https://kre8.fun', docs: 'https://docs.gullychain.xyz/' }
    case 'pay':
      return {
        line: <>x402 payments on Base, Ethereum, BNB Chain, Solana and <b>Gully Chain</b>, checkout, merchant stores and USDC run on Gully Pay&apos;s own platform. Your Gully Labs plan is still paid in Billing here, through Gully Pay checkout.</>,
        docs: 'https://gullypay.xyz/docs',
        legacy: <>Already run a store from this workspace? Its pay links and invoices keep working. {here('Manage that store', 'merchant')}</>,
      }
    case 'rpc':
      return { line: <>RPC keys, usage and <b>every Gully chain behind one endpoint</b>: rpc.gullyrpc.xyz/&lt;project&gt;/evm/&lt;chainId&gt;, Gully Chain testnet included.</>, href: 'https://app.gullyrpc.xyz', docs: 'https://gullyrpc.xyz/docs/' }
    case 'ipfs':
      return { line: <>Our Kubo node and read-only gateway at <b>ipfs.gullylabs.xyz/ipfs/&lt;CID&gt;</b>: token art, metadata, NFT art and .gully sites, pinned for good.</>, href: 'https://docs.gullylabs.xyz/ipfs', docs: 'https://docs.gullylabs.xyz/ipfs' }
    case 'holders':
      return { line: <>Bubble maps, wallet clusters and deep checks for any token, <b>Gully Chain tokens included</b>. Holder alerts stay in Alerts here.</>, legacy: <>Cluster and holder alerts for the tokens you watch: {here('Open Alerts', 'alerts')}</> }
    case 'security':
      return { line: <>AI security scans, contract monitors and published reports run in <b>the Gully Security app</b>. Report badges and the scan API keep their addresses.</>, legacy: <>Scans and monitors made here before the move: {here('Open them', 'scans')}</> }
    case 'studio':
      return { line: <>Our game studio: <b>Unity 3D titles on Gully Chain</b> with the Gully Game SDK, paid through Gully Pay.</> }
  }
}

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

/** `?alert=<chain>:<TICKER>` with #alerts (the stock pages' "Set an alert" links): that stock, or null.
    `?alert=holders:<chain>:<token>` (the Holder Map's "Alert me") opens a holder alert for that token. */
function alertFromUrl(): string | null {
  if (window.location.hash !== '#alerts') return null
  const v = new URLSearchParams(window.location.search).get('alert') ?? ''
  const h = v.match(/^holders:([a-z]{2,12}):([A-Za-z0-9.]{1,64})$/)
  if (h) return `holders:${h[1]}:${h[2]}`
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

  const liveKeys = account.keys.filter((k) => !k.revokedAt).length
  const items: NavItem<AppTab>[] = useMemo(
    () => grouped(ALL_TABS.filter((t) => !HIDDEN.has(t.id))).map((t) => (t.id === 'keys' && liveKeys > 0 ? { ...t, badge: <span className="rounded-full bg-surface-deep px-[6px] font-mono text-[11px] text-faint">{liveKeys}</span> } : t)),
    [liveKeys],
  )
  const page = ALL_TABS.find((t) => t.id === tab)?.label ?? 'Overview'
  // What the service pages get: the account, navigation by page id, and "add alert" for a stock.
  const service = useMemo(
    () => ({
      account,
      go: (t: string, s: string | null = null) => go((ALL_TABS.some((x) => x.id === t) ? t : (LEGACY[t] ?? 'overview')) as AppTab, s),
      createAlert: (stock: string | null = null) => {
        setAlertFor(stock)
        setNewAlert(true)
        go('alerts')
      },
    }),
    [account, go],
  )

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

      <main key={`${wsKey}:${tab}`} id={`panel-${tab}`} aria-label={page} tabIndex={-1} data-focus-fallback data-testid="app-page" data-page={tab} className="mx-auto min-h-[60vh] w-full max-w-[1240px] animate-[gl-rise_.3s_cubic-bezier(.2,.8,.2,1)_both] px-6 pt-3 pb-6 outline-none max-[480px]:px-4">
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
        {/* Gully Security hands off once gullysecurity.xyz is its home (SECURITY_PRIMARY); until then the page is here. */}
        {tab === 'security' && !securityPrimary() && <SecurityTab section={section} />}
        {tab === 'scans' && <SecurityTab section={section} />}
        {tab === 'billing' && <Billing account={account} reload={reload} intent={intent} onIntentDone={clearIntent} />}
        {tab === 'merchant' && <MerchantTab />}
        {tab === 'team' && <Team />}
        {tab === 'activity' && <ActivityTab />}
        {tab === 'settings' && <SettingsTab section={section} />}
        {isServiceTab(tab) && <ServiceView id={tab} ctx={service} />}
        {isHandoffTab(tab) && !(tab === 'security' && !securityPrimary()) && <ProductHandoff k={HANDOFF_TABS.find((h) => h.id === tab)!.product} copy={handoffCopy(tab, goTab)} />}
      </main>
    </AppShell>
  )
}
