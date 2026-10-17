import { BookOpen, Copy, LogOut } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { DOCS_URL } from '../../site-host'
import { Alerts } from './Alerts'
import { AnalyticsPanel } from './Analytics'
import { daysLeft, shortAddress, type Account, type PlanId } from './api'
import { Billing, type CheckoutIntent } from './Billing'
import { KeysTab } from './Keys'
import { Overview } from './Overview'

/* The signed-in console ("B · Console app"): a header with the plan pill, Docs and the wallet, and
   five underlined tabs. Tabs are deep-linkable by hash (#keys, #alerts, #analytics, #billing; the
   pricing page links to #billing) and work as an ARIA tablist (arrow keys, Home, End). The old tab
   hashes #quickstart, #requests and #widget open Keys at that section. */

export type Tab = 'overview' | 'keys' | 'alerts' | 'analytics' | 'billing'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'keys', label: 'Keys' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'billing', label: 'Billing' },
]
const LEGACY: Record<string, Tab> = { quickstart: 'keys', requests: 'keys', widget: 'keys' }

function readHash(): { tab: Tab; section: string | null } {
  const h = window.location.hash.slice(1)
  if (TABS.some((t) => t.id === h)) return { tab: h as Tab, section: null }
  if (LEGACY[h]) return { tab: LEGACY[h], section: h }
  return { tab: 'overview', section: null }
}

function useTab(): [{ tab: Tab; section: string | null }, (t: Tab) => void] {
  const [state, setState] = useState(readHash)
  useEffect(() => {
    const on = () => setState(readHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const set = useCallback((t: Tab) => {
    history.replaceState(null, '', t === 'overview' ? window.location.pathname + window.location.search : `#${t}`)
    setState({ tab: t, section: null })
  }, [])
  return [state, set]
}

function WalletMenu({ address, onSignOut }: { address: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(id)
  }, [copied])
  const hue = parseInt(address.slice(2, 6), 16) % 360
  const item = 'flex min-h-11 w-full items-center gap-3 rounded-[8px] px-3 text-left text-[14px] text-ink-2 hover:bg-surface-hover hover:text-ink'
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Wallet ${address}`}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 items-center gap-2 rounded-full border border-line-strong bg-surface px-3 font-mono text-[12px] text-ink transition-colors hover:border-line-hover"
      >
        <span aria-hidden className="size-[14px] rounded-full" style={{ background: `conic-gradient(from ${hue}deg, #6aa6ff, #e8c060, #6fcf6a, #6aa6ff)` }} />
        {shortAddress(address)}
      </button>
      {open && (
        <div role="menu" className="absolute top-12 right-0 z-30 flex w-[230px] animate-[gl-rise_.18s_ease_both] flex-col rounded-[12px] border border-line-strong bg-surface-deep p-1 shadow-[0_12px_32px_rgba(0,0,0,.5)]">
          <span className="px-3 pt-2 pb-1 font-mono text-[10.5px] break-all text-faint">{address}</span>
          <span className="px-3 pb-2 text-[11px] text-faint">Signed in with this wallet (SIWE)</span>
          <button
            role="menuitem"
            type="button"
            className={item}
            onClick={() =>
              navigator.clipboard?.writeText(address).then(
                () => setCopied(true),
                () => undefined,
              )
            }
          >
            <Copy size={15} aria-hidden /> {copied ? 'Copied' : 'Copy address'}
          </button>
          <button
            role="menuitem"
            type="button"
            className={`${item} hover:!text-error`}
            onClick={() => {
              setOpen(false)
              onSignOut()
            }}
          >
            <LogOut size={15} aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
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

export function Dashboard({ account, reload, onSignOut }: { account: Account; reload: () => Promise<void>; onSignOut: () => void }) {
  const [{ tab, section }, setTab] = useTab()
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
  const go = useCallback((t: Tab) => {
    setTab(t)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [setTab])

  return (
    <div className="flex flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-[10px] px-6 pt-3 max-[480px]:px-4">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => go('overview')} className="flex min-h-11 items-center gap-[10px] text-ink">
              <span aria-hidden className="grid size-[26px] place-items-center rounded-[8px] bg-gold font-display text-[17px] font-extrabold text-bg">
                G
              </span>
              <span className="font-semibold">Developers</span>
            </button>
            <span className="text-line-strong" aria-hidden>
              /
            </span>
            <PlanPill account={account} />
            <span className="ml-auto flex items-center gap-2">
              <a href={`${DOCS_URL}/api`} className="inline-flex min-h-11 items-center gap-[6px] rounded-full px-3 text-[13px] text-muted hover:text-ink">
                <BookOpen size={14} aria-hidden /> Docs
              </a>
              <WalletMenu address={account.address} onSignOut={onSignOut} />
            </span>
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
                  className={`min-h-11 shrink-0 border-b-2 px-[14px] font-medium whitespace-nowrap transition-colors -outline-offset-2 ${on ? 'border-gold text-ink' : 'border-transparent text-dim hover:text-ink'}`}
                >
                  {t.label}
                  {t.id === 'keys' && <span className="ml-2 rounded-full bg-surface-deep px-[6px] font-mono text-[11px] text-faint">{account.keys.filter((k) => !k.revokedAt).length}</span>}
                </button>
              )
            })}
          </div>
        </div>
      </header>

      <div key={tab} id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={-1} className="mx-auto w-full max-w-[1240px] animate-[gl-rise_.3s_cubic-bezier(.2,.8,.2,1)_both] px-6 pt-5 pb-16 outline-none max-[480px]:px-4">
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
        {tab === 'keys' && <KeysTab account={account} reload={reload} creating={newKey} onCreateDone={clearNewKey} section={section} />}
        {tab === 'alerts' && <Alerts goBilling={() => go('billing')} creating={newAlert} onCreateDone={clearNewAlert} />}
        {tab === 'analytics' && <AnalyticsPanel />}
        {tab === 'billing' && <Billing account={account} reload={reload} intent={intent} onIntentDone={clearIntent} />}
      </div>
    </div>
  )
}
