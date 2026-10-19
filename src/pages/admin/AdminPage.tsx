import { Fragment, lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { DayBars } from '../../components/charts/DayBars'
import { byChain } from '../../components/pay/assets'
import { Wordmark } from '../../components/brand'
import type { PayAsset } from '../developers/api'
import type { Invoice } from '../pay/invoice'
import { adminCall } from './payAdmin'
import { DeliveryLog, EmbedBox, PayLinks, SecretOnce, type Delivery, type Endpoint } from './PayLinks'
import { AskStudio } from './AskStudio'
import { TelegramChats } from './TelegramChats'
import { MerchantsAdmin } from './MerchantsAdmin'
import { SecurityCard } from './SecurityCard'
import { TelegramChannel } from './TelegramChannel'
import { LaunchRadar } from './LaunchRadar'
import { TreasurySafe } from './TreasurySafe'
import { TelegramBroadcasts } from './TelegramBroadcasts'
import { copyWithToast, flash } from '../../components/ui/toast'
import { ChartBox } from '../../components/charts/ChartSkeleton'
import { FeeProxyBanner, FeeProxyCard, type FeeProxyStatus } from './FeeProxyCard'
import { isFeeProxy } from '../../../server/fee-proxy-guard.mjs'
import { ChainLogo } from '../../components/logos/ChainLogo'
import { toastError } from '../../components/ui/toast'
import { LogOut, RefreshCw } from 'lucide-react'
import { AdminNav } from './AdminNav'
import { pillCls } from './ui'
import { sectionCls } from './adminSections'
import { HealthCard } from './HealthCard'
import { AlertsAdmin, ChainKitAdmin, WorkspacesAdmin } from './OpsAdmin'
import { ChainsWaitlist } from './ChainsWaitlist'
import { ArrowMark } from './newTab'
import { EcosystemSubmissions } from './EcosystemSubmissions'

// The live charts (and ECharts with them) load on demand, after the dashboard's own figures.
const AdminCharts = lazy(() => import('./AdminCharts'))

/* The private admin dashboard. Everything comes from /api/admin/* behind ADMIN_TOKEN; the token is
   kept in this tab's sessionStorage only. Refreshes every 30 seconds. Not linked from the site.
   A sticky section nav (AdminNav) jumps between the sections below; Health comes first. */

interface Overview {
  generatedAt: string
  tracker: {
    cacheAgeSeconds: number | null
    lastSnapshot: string | null
    chains: { key: string; name: string; stocks: number; lastPoolRead: string | null; backoffUntil: string | null; sessionOpen: boolean }[]
    history: { series: number; points: number }
    statuses: Record<string, number> | null
  }
  api: { since: string; anonymousLimitPerMin: number; anonymous: { requests: number; limited: number }; keys: { id: string; requests: number; limited: number; lastUsed: string | null }[]; days: { day: string; anonymous: number; keyed: number; limited: number }[]; liveWindows: number }
  venues: { generatedAt?: string; unread?: string[]; list?: { key: string; state: string; error: string | null }[]; error?: string }
  developers: { pending: number; approved: number; liveKeys: number; accounts?: number; blocked?: number }
  enquiries: { total: number; open: number }
  launchList: number
  feeProxy?: FeeProxyStatus
  process: { uptimeSeconds: number; rssMb: number; heapMb: number; node: string; dataDirBytes: number | null }
}
interface Req {
  id: string
  email: string
  project: string
  url: string | null
  use: string
  status: string
  createdAt: string
  decidedAt: string | null
  claimedAt: string | null
}
interface Key {
  id: string
  prefix: string
  name: string | null
  owner: string | null
  project: string | null
  email: string
  limit: number
  createdAt: string
  revokedAt: string | null
}
interface DevAccount {
  address: string
  createdAt: string
  lastLoginAt: string | null
  blocked: boolean
  blockedAt: string | null
  keys: number
  liveKeys: number
}
interface Billing {
  subscriptions: { address: string; plan: string; since: string | null; expiresAt: string; source: string | null; active: boolean }[]
  payments: { txHash: string; kind: 'plan' | 'invoice' | 'analytics'; address: string | null; plan: string | null; invoiceId: string | null; amount: string; symbol: string; chain: string; usd: string | null; txUrl: string | null; from: string; at: string; expiresAt: string | null }[]
  offer: { plans: { id: string; name: string; priceUsdc: number }[]; checkout: { enabled: boolean; treasury: string | null; reason?: string } }
  alerts: { total: number; enabled: number; owners: number }
  /** The treasury deployment gate (server/treasury-chains.mjs): which chains the Safe treasury exists on. */
  treasury?: TreasuryGate
}
interface TreasuryGate {
  treasury: string | null
  kind: 'contract' | 'eoa' | 'unknown'
  pinned: string | null
  checkedAt: string | null
  intervalMs: number
  safeApp: string
  chains: { chainId: number; chain: string; key: string | null; status: 'deployed' | 'eoa' | 'missing' | 'unknown'; offered: boolean; checkedAt: string | null; error: string | null; message: string }[]
}
interface AnalyticsAdmin {
  configured: boolean
  accounts: { address: string; username: string; createdAt: string; state: 'trial' | 'active' | 'lapsed'; plan: string | null; planName: string | null; expiresAt: string | null; source: string | null; lapsedAt: string | null; readableUntil: string | null; deletable: boolean; sites: number; eventsThisMonth: number; eventsLimit: number | null }[]
  offer: { plans: { id: string; name: string; priceUsdc: number; sites: number; eventsPerMonth: number }[]; trialDays: number; graceDays: number; periodDays: number }
}
interface Enquiry {
  id: string
  receivedAt: string
  name: string
  email: string
  message: string
  types: string[]
  budget: string
  handled?: boolean
}

const TOKEN = 'gully-admin-token'
/** Address fields refuse Request's fee proxy contracts (server/fee-proxy-guard.mjs), as the server does. */
const proxyNote = (v: string) => (isFeeProxy(v.trim()) ? "That is Request Network's fee proxy contract, not a wallet." : '')
const card = 'flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-6'
const h2 = 'm-0 font-display text-[22px] font-bold uppercase'
const small = 'font-mono text-[12px] text-faint'
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—')
const ago = (iso: string | null) => {
  if (!iso) return 'never'
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000)
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`
}

function getToken() {
  try {
    return sessionStorage.getItem(TOKEN)
  } catch {
    return null
  }
}
function setToken(t: string | null) {
  try {
    if (t) sessionStorage.setItem(TOKEN, t)
    else sessionStorage.removeItem(TOKEN)
  } catch {
    /* private mode */
  }
}

function useAdmin(token: string | null) {
  const [data, setData] = useState<{ overview: Overview; requests: Req[]; keys: Key[]; accounts: DevAccount[]; enquiries: Enquiry[]; launch: { email: string; slot: string; addedAt: string }[]; billing: Billing; invoices: { invoices: AdminInvoice[]; assets: PayAsset[] }; analytics: AnalyticsAdmin } | null>(null)
  const [err, setErr] = useState<{ status: number; message: string } | null>(null)
  const load = useCallback(async () => {
    if (!token) return
    const get = async (p: string) => {
      const r = await fetch(p, { headers: { authorization: `Bearer ${token}` } })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw { status: r.status, message: d.error ?? `HTTP ${r.status}` }
      return d
    }
    try {
      const [overview, dev, enq, launch, billing, invoices, analytics] = await Promise.all([get('/api/admin/overview'), get('/api/admin/developers'), get('/api/admin/enquiries'), get('/api/admin/launch-list'), get('/api/admin/billing'), get('/api/admin/invoices'), get('/api/admin/analytics')])
      setData({ overview, requests: dev.requests, keys: dev.keys, accounts: dev.accounts ?? [], enquiries: enq.enquiries, launch: launch.rows, billing, invoices, analytics })
      setErr(null)
    } catch (e) {
      const x = e as { status?: number; message?: string }
      setErr({ status: x.status ?? 0, message: x.message ?? 'The server could not be reached.' })
    }
  }, [token])
  useEffect(() => {
    if (!token) return
    let alive = true
    const tick = () => alive && load()
    tick()
    const id = setInterval(tick, 30_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [token, load])
  return { data, err, reload: load }
}

function Tile({ k, v, note, tone }: { k: string; v: string; note?: string; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-surface px-5 py-4" style={{ animation: 'gl-rise .45s ease both' }}>
      <span className="font-mono text-[11px] tracking-[1px] text-faint">{k}</span>
      <span className="font-display text-[30px] leading-none font-extrabold" style={{ color: tone }}>
        {v}
      </span>
      {note && <span className="truncate text-[12px] text-muted">{note}</span>}
    </div>
  )
}

function Login({ onToken, error }: { onToken: (t: string) => void; error: string | null }) {
  const [t, setT] = useState('')
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-6">
      <form
        className="flex w-full max-w-[420px] flex-col gap-5 rounded-card border border-line bg-surface p-8"
        onSubmit={(e) => {
          e.preventDefault()
          if (t.trim()) onToken(t.trim())
        }}
      >
        <Wordmark height={28} />
        <div className="flex flex-col gap-1">
          <h1 className="m-0 font-display text-[30px] font-extrabold uppercase">Admin</h1>
          <span className="text-[14px] text-muted">Enter the admin token. It stays in this tab only.</span>
        </div>
        <label className="flex flex-col gap-2 text-[14px] text-ink-2">
          Admin token
          <input type="password" autoComplete="off" value={t} onChange={(e) => setT(e.target.value)} className="h-11 rounded-input border border-line-strong bg-bg px-3 font-mono text-[14px] text-ink outline-none focus:border-gold" />
        </label>
        {error && <p className="m-0 text-[14px] text-error">{error}</p>}
        <button type="submit" className="min-h-11 rounded-btn bg-gold px-5 text-[15px] font-semibold text-bg transition-colors hover:bg-gold-hover">
          Sign in
        </button>
      </form>
    </main>
  )
}

/** Where the Safe treasury exists (server/treasury-chains.mjs): a chain without it is not offered until the Safe is deployed there. */
function TreasuryChains({ t, act }: { t: TreasuryGate; act: (path: string, body?: unknown) => Promise<string | null> }) {
  const [busy, setBusy] = useState(false)
  const closed = t.chains.filter((c) => !c.offered)
  const pill = (s: TreasuryGate['chains'][number]['status']) => (s === 'deployed' || s === 'eoa' ? 'border-success-line text-green' : s === 'missing' ? 'border-[#5a2a24] text-error' : 'border-line-strong text-faint')
  const label = (s: TreasuryGate['chains'][number]['status']) => (s === 'deployed' ? 'deployed' : s === 'eoa' ? 'wallet' : s === 'missing' ? 'not deployed' : 'unread')
  return (
    <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-bg px-4 py-3" aria-label="Treasury per chain">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] text-ink-2">
          Treasury on each chain · {t.kind === 'contract' ? 'a contract (Safe)' : t.kind === 'eoa' ? 'a normal wallet' : 'kind not known yet'}
          {t.pinned ? ` (pinned: GULLY_TREASURY_KIND=${t.pinned})` : ''} · {closed.length ? `${closed.length} chain${closed.length === 1 ? '' : 's'} not offered` : 'offered on every chain'}
        </span>
        <span className="flex items-center gap-3">
          <span className={small}>checked {t.checkedAt ? new Date(t.checkedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : 'not yet'} · every {Math.round(t.intervalMs / 60_000)} min</span>
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-2 rounded-btn border border-line-strong px-3 font-mono text-[12px] text-ink-2 transition-colors hover:border-gold hover:text-gold disabled:opacity-50"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              const err = await act('/api/admin/treasury/check')
              setBusy(false)
              flash(err ? { ok: false, text: err } : { ok: true, text: 'Every chain read again.' })
            }}
          >
            {busy ? 'Reading…' : 'Check now'}
          </button>
        </span>
      </div>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-2 p-0">
        {t.chains.map((c) => (
          <li key={c.chainId} className="flex items-start gap-2 text-[13px]">
            <ChainLogo chain={c.key ?? c.chain} size={20} decorative />
            <span className="flex min-w-0 flex-col gap-[2px]">
              <span className="flex items-center gap-2 text-ink">
                {c.chain}
                <span className={pillCls(pill(c.status))}>{label(c.status)}</span>
                {!c.offered && <span className="font-mono text-[11px] text-error">not offered</span>}
              </span>
              <span className={`text-[12px] leading-[1.5] ${c.status === 'missing' ? 'text-ink-2' : 'text-faint'}`}>{c.message}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Paid plans: who has one, every payment, and a manual grant / revoke. */
function Subscriptions({ billing, accounts, act, invoices }: { billing: Billing; accounts: DevAccount[]; act: (path: string, body?: unknown) => Promise<string | null>; invoices: AdminInvoice[] }) {
  const invoiceNumber = (id: string | null) => invoices.find((i) => i.id === id)?.number ?? id ?? '—'
  const [address, setAddress] = useState('')
  const [plan, setPlan] = useState('pro')
  const [days, setDays] = useState('30')
  const setMsg = flash
  const field = 'h-10 rounded-input border border-line-strong bg-bg px-3 font-mono text-[13px] text-ink outline-none focus:border-gold'
  const grant = async (addr: string, p: string, d?: number) => {
    const err = await act(`/api/admin/accounts/${addr}/plan`, { plan: p, days: d })
    setMsg(err ? { ok: false, text: err } : { ok: true, text: p === 'free' ? `${addr} is back on Free.` : `${addr} has ${p} for ${d} days.` })
  }
  const c = billing.offer.checkout
  return (
    <section className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={h2}>Subscriptions</h2>
        <span className={small}>
          checkout {c.enabled ? `open · treasury ${c.treasury}` : 'off: GULLY_TREASURY_ADDRESS is not set'} · {billing.alerts.enabled} live alerts of {billing.alerts.total} ({billing.alerts.owners} wallets)
        </span>
      </div>
      {billing.treasury && <TreasuryChains t={billing.treasury} act={act} />}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          grant(address.trim().toLowerCase(), plan, Number(days))
        }}
      >
        <label className="flex min-w-[min(100%,360px)] flex-1 flex-col gap-1 text-[12px] text-faint">
          Wallet
          <input list="admin-wallets" className={field} value={address} onChange={(e) => (setAddress(e.target.value), e.target.setCustomValidity(proxyNote(e.target.value)))} placeholder="0x…" required pattern="0x[0-9a-fA-F]{40}" />
          <datalist id="admin-wallets">
            {accounts.map((a) => (
              <option key={a.address} value={a.address} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-faint">
          Plan
          <select className={field} value={plan} onChange={(e) => setPlan(e.target.value)}>
            {billing.offer.plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === 'free' ? 'free (revoke)' : p.name}
              </option>
            ))}
          </select>
        </label>
        {plan !== 'free' && (
          <label className="flex w-[90px] flex-col gap-1 text-[12px] text-faint">
            Days
            <input className={field} type="number" min={1} max={3660} value={days} onChange={(e) => setDays(e.target.value)} required />
          </label>
        )}
        <button type="submit" className="h-10 rounded-btn bg-gold px-4 text-[14px] font-semibold text-bg hover:bg-gold-hover">
          {plan === 'free' ? 'Revoke plan' : 'Grant plan'}
        </button>
      </form>
      {!billing.subscriptions.length ? (
        <p className="m-0 text-[14px] text-muted">No wallet has a paid or granted plan yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
                <th className="py-2 pr-3 font-medium">WALLET</th>
                <th className="py-2 pr-3 font-medium">PLAN</th>
                <th className="py-2 pr-3 font-medium">SOURCE</th>
                <th className="py-2 pr-3 font-medium">SINCE</th>
                <th className="py-2 pr-3 font-medium">UNTIL</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {billing.subscriptions.map((s) => (
                <tr key={s.address} className="border-b border-line last:border-b-0">
                  <td className="py-3 pr-3 font-mono text-[12px] text-ink-2">{s.address}</td>
                  <td className="py-3 pr-3 font-mono text-[12px] uppercase">{s.plan}</td>
                  <td className="py-3 pr-3 font-mono text-[12px] text-faint">{s.source ?? '—'}</td>
                  <td className="py-3 pr-3 font-mono text-[12px] text-faint">{when(s.since)}</td>
                  <td className="py-3 pr-3 font-mono text-[12px]">{s.active ? <span className="text-green">{when(s.expiresAt)}</span> : <span className="text-faint">lapsed {when(s.expiresAt)}</span>}</td>
                  <td className="py-3 text-right whitespace-nowrap">
                    {s.active && (
                      <button type="button" onClick={() => window.confirm(`Revoke ${s.plan} from ${s.address}? It returns to Free now.`) && grant(s.address, 'free')} className="rounded-btn border border-line-strong px-3 py-[6px] text-[13px] text-ink-2 hover:border-error hover:text-error">
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3 className="m-0 font-mono text-[12px] tracking-[1px] text-faint">PAYMENTS ({billing.payments.length})</h3>
      {!billing.payments.length ? (
        <p className="m-0 text-[14px] text-muted">No payments yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
                <th className="py-2 pr-3 font-medium">WHEN</th>
                <th className="py-2 pr-3 font-medium">FOR</th>
                <th className="py-2 pr-3 font-medium">FROM</th>
                <th className="py-2 pr-3 font-medium">AMOUNT</th>
                <th className="py-2 pr-3 font-medium">CHAIN</th>
                <th className="py-2 pr-3 font-medium">TRANSACTION</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {billing.payments.map((p) => (
                <tr key={`${p.chain}:${p.txHash}`} className="border-b border-line last:border-b-0">
                  <td className="py-2 pr-3 text-faint">{when(p.at)}</td>
                  <td className="py-2 pr-3">{p.kind === 'plan' ? <span className="uppercase">{p.plan}</span> : p.kind === 'analytics' ? <span className="uppercase">Analytics {p.plan}</span> : `Invoice ${invoiceNumber(p.invoiceId)}`}</td>
                  <td className="py-2 pr-3 text-ink-2">{p.kind === 'invoice' ? p.from : p.address}</td>
                  <td className="py-2 pr-3">
                    {p.amount} {p.symbol}
                    {p.usd && <span className="block text-[11px] text-faint">{p.usd} USD</span>}
                  </td>
                  <td className="py-2 pr-3 text-faint">{p.chain}</td>
                  <td className="py-2 pr-3">
                    {p.txUrl ? (
                      <a href={p.txUrl} target="_blank" rel="noopener noreferrer" className="text-ink-2 hover:text-gold">
                        {p.txHash.slice(0, 10)}…
                        <ArrowMark />
                      </a>
                    ) : (
                      p.txHash.slice(0, 10)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** Gully Analytics accounts (self-serve): plan, websites, events this month; grant, revoke, delete. */
function AnalyticsAccounts({ data, act }: { data: AnalyticsAdmin; act: (path: string, body?: unknown) => Promise<string | null> }) {
  const [address, setAddress] = useState('')
  const [plan, setPlan] = useState('starter')
  const [days, setDays] = useState('30')
  const setMsg = flash
  const field = 'h-10 rounded-input border border-line-strong bg-bg px-3 font-mono text-[13px] text-ink outline-none focus:border-gold'
  const paid = data.offer.plans.filter((p) => p.priceUsdc > 0)
  const grant = async (addr: string, p: string, d?: number) => {
    const err = await act(`/api/admin/analytics/${addr}/plan`, { plan: p, days: d })
    setMsg(err ? { ok: false, text: err } : { ok: true, text: p === 'none' ? `${addr}: plan and trial stopped; its events are refused now.` : `${addr} has Analytics ${p} for ${d} days.` })
  }
  const remove = async (addr: string) => {
    const err = await act(`/api/admin/analytics/${addr}/delete`)
    setMsg(err ? { ok: false, text: err } : { ok: true, text: `${addr}: account, Gully Analytics user and its data deleted.` })
  }
  const stateCls = { trial: 'text-gold', active: 'text-green', lapsed: 'text-error' }
  return (
    <section className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={h2}>Gully Analytics</h2>
        <span className={small}>
          {data.configured ? 'self-serve on' : 'self-serve off: ANALYTICS_ADMIN_PASSWORD is not set'} · {data.accounts.length} account{data.accounts.length === 1 ? '' : 's'} · lapsed accounts stay readable {data.offer.graceDays} days, then can be deleted
        </span>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          grant(address.trim().toLowerCase(), plan, Number(days))
        }}
      >
        <label className="flex min-w-[min(100%,360px)] flex-1 flex-col gap-1 text-[12px] text-faint">
          Wallet
          <input list="admin-analytics-wallets" className={field} value={address} onChange={(e) => (setAddress(e.target.value), e.target.setCustomValidity(proxyNote(e.target.value)))} placeholder="0x…" required pattern="0x[0-9a-fA-F]{40}" />
          <datalist id="admin-analytics-wallets">
            {data.accounts.map((a) => (
              <option key={a.address} value={a.address} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-faint">
          Plan
          <select className={field} value={plan} onChange={(e) => setPlan(e.target.value)}>
            {paid.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="none">none (revoke)</option>
          </select>
        </label>
        {plan !== 'none' && (
          <label className="flex w-[90px] flex-col gap-1 text-[12px] text-faint">
            Days
            <input className={field} type="number" min={1} max={3660} value={days} onChange={(e) => setDays(e.target.value)} required />
          </label>
        )}
        <button type="submit" className="h-10 rounded-btn bg-gold px-4 text-[14px] font-semibold text-bg hover:bg-gold-hover">
          {plan === 'none' ? 'Revoke' : 'Grant plan'}
        </button>
      </form>
      {!data.accounts.length ? (
        <p className="m-0 text-[14px] text-muted">No wallet has started Gully Analytics yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
                <th className="py-2 pr-3 font-medium">WALLET</th>
                <th className="py-2 pr-3 font-medium">LOGIN</th>
                <th className="py-2 pr-3 font-medium">PLAN</th>
                <th className="py-2 pr-3 font-medium">UNTIL</th>
                <th className="py-2 pr-3 font-medium">SITES</th>
                <th className="py-2 pr-3 font-medium">EVENTS THIS MONTH</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr key={a.address} className="border-b border-line last:border-b-0">
                  <td className="py-3 pr-3 font-mono text-[12px] text-ink-2">{a.address}</td>
                  <td className="py-3 pr-3 font-mono text-[12px] text-faint">{a.username}</td>
                  <td className="py-3 pr-3 font-mono text-[12px]">
                    <span className={stateCls[a.state]}>{a.state === 'lapsed' ? 'lapsed' : a.planName}</span>
                    {a.source && a.state === 'active' && <span className="block text-[11px] text-faint">{a.source}</span>}
                  </td>
                  <td className="py-3 pr-3 font-mono text-[12px] text-faint">{a.state === 'lapsed' ? `readable to ${when(a.readableUntil)}` : when(a.expiresAt)}</td>
                  <td className="py-3 pr-3 font-mono text-[12px]">{a.sites}</td>
                  <td className="py-3 pr-3 font-mono text-[12px]">
                    {a.eventsThisMonth.toLocaleString('en-US')}
                    {a.eventsLimit !== null && <span className="text-faint"> / {a.eventsLimit.toLocaleString('en-US')}</span>}
                  </td>
                  <td className="py-3 text-right whitespace-nowrap">
                    {a.state !== 'lapsed' && (
                      <button type="button" onClick={() => window.confirm(`Stop Gully Analytics for ${a.address}? Its events are refused from now.`) && grant(a.address, 'none')} className="rounded-btn border border-line-strong px-3 py-[6px] text-[13px] text-ink-2 hover:border-error hover:text-error">
                        Revoke
                      </button>
                    )}
                    {a.deletable && (
                      <button type="button" onClick={() => window.confirm(`Delete the Gully Analytics account of ${a.address}, its user and all its data? This cannot be undone.`) && remove(a.address)} className="rounded-btn border border-error px-3 py-[6px] text-[13px] text-error hover:bg-[rgba(255,138,122,.08)]">
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

type AdminInvoice = Invoice & { path: string; webhook: Endpoint | null }
const STATUS_CLS: Record<string, string> = { open: 'text-gold', paid: 'text-green', expired: 'text-faint', cancelled: 'text-faint' }

/** Below an invoice row: its "Pay with crypto" embed and its own merchant webhook with the delivery log. */
function InvoiceExtras({ token, invoice, reload, onSecret }: { token: string; invoice: AdminInvoice; reload: () => void; onSecret: (s: string) => void }) {
  const [url, setUrl] = useState('')
  const setMsg = flash
  const [log, setLog] = useState<Delivery[] | null>(null)
  const loadLog = useCallback(() => {
    adminCall<{ deliveries: Delivery[] }>(token, `/api/admin/invoices/${invoice.id}/deliveries`).then((r) => r.ok && setLog(r.data.deliveries))
  }, [token, invoice.id])
  useEffect(() => {
    loadLog()
  }, [loadLog, invoice.status])
  const call = async (path: string, body: unknown, done: string) => {
    const r = await adminCall<{ secret?: string | null; delivery?: Delivery }>(token, path, body)
    if (!r.ok) return setMsg({ ok: false, text: r.error })
    if (r.data.secret) onSecret(r.data.secret)
    setMsg(r.data.delivery ? { ok: r.data.delivery.state === 'delivered', text: r.data.delivery.state === 'delivered' ? `Webhook test delivered (${r.data.delivery.last?.status}).` : `Webhook test failed: ${r.data.delivery.last?.error ?? r.data.delivery.last?.status}` } : { ok: true, text: done })
    setUrl('')
    reload()
    loadLog()
  }
  const btn = 'inline-flex min-h-11 items-center rounded-btn border border-line-strong px-3 text-[13px] text-ink-2 hover:border-gold'
  return (
    <div className="flex flex-col gap-4 rounded-input border border-line bg-bg p-4">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[11px] tracking-[1px] text-faint">EMBED</span>
        <EmbedBox path={invoice.path} />
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[11px] tracking-[1px] text-faint">WEBHOOK OF THIS INVOICE</span>
        {invoice.webhook ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 font-mono text-[12px] break-all text-ink-2">{invoice.webhook.url}</code>
            <button type="button" className={btn} onClick={() => call(`/api/admin/invoices/${invoice.id}/webhook/test`, {}, 'Test sent.')}>
              Send test event
            </button>
            <button type="button" className={btn} onClick={() => window.confirm('Rotate the signing secret?') && call(`/api/admin/invoices/${invoice.id}/webhook/rotate`, {}, 'Secret rotated.')}>
              Rotate secret
            </button>
            <button type="button" className={`${btn} hover:border-error hover:text-error`} onClick={() => call(`/api/admin/invoices/${invoice.id}/webhook`, { url: null }, 'Webhook removed.')}>
              Remove
            </button>
          </div>
        ) : (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              call(`/api/admin/invoices/${invoice.id}/webhook`, { url }, 'Webhook set.')
            }}
          >
            <input className="h-10 min-w-[min(100%,300px)] flex-1 rounded-input border border-line-strong bg-bg px-3 font-mono text-[13px] text-ink outline-none focus:border-gold" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/gully" required aria-label="Webhook URL for this invoice" />
            <button type="submit" className={btn}>
              Set webhook
            </button>
          </form>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[11px] tracking-[1px] text-faint">DELIVERIES</span>
        {log ? <DeliveryLog rows={log} token={token} onChange={loadLog} /> : <span className="font-mono text-[12px] text-faint">Loading…</span>}
      </div>
    </div>
  )
}

/* Gully Pay invoices for everything that is not an API plan. The link is the only way to the pay page. */
function Invoices({ invoices, assets, act, token, reload }: { invoices: AdminInvoice[]; assets: PayAsset[]; act: (path: string, body?: unknown) => Promise<string | null>; token: string; reload: () => void }) {
  const [title, setTitle] = useState('')
  const [usd, setUsd] = useState('')
  const [note, setNote] = useState('')
  const [days, setDays] = useState('30')
  const [hook, setHook] = useState('')
  const [chosen, setChosen] = useState<string[]>(() => assets.map((a) => a.id))
  const setMsg = flash
  const [secret, setSecret] = useState<string | null>(null)
  const [extras, setExtras] = useState<string | null>(null)
  const field = 'h-10 rounded-input border border-line-strong bg-bg px-3 text-[14px] text-ink outline-none focus:border-gold'
  const link = (path: string) => `${window.location.protocol}//${window.location.host.replace(/^admin\./, '')}${path}`
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))
  const create = async () => {
    const r = await adminCall<{ secret: string | null }>(token, '/api/admin/invoices', { title, usd, note, assets: chosen, expiresInDays: Number(days), webhookUrl: hook.trim() || undefined })
    reload()
    if (!r.ok) return setMsg({ ok: false, text: r.error })
    if (r.data.secret) setSecret(r.data.secret)
    setMsg({ ok: true, text: 'Invoice created: copy its link from the top of the list.' })
    setTitle('')
    setUsd('')
    setNote('')
    setHook('')
  }
  const copy = (path: string) =>
    copyWithToast(link(path), 'Link')
  const btn = 'inline-flex min-h-11 items-center rounded-btn border border-line-strong px-3 text-[13px] text-ink-2 hover:border-gold'
  return (
    <section className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={h2}>Invoices</h2>
        <span className={small}>Gully Pay · Gully Analytics, services · anyone with the link can pay</span>
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          create()
        }}
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[min(100%,320px)] flex-[2] flex-col gap-1 text-[12px] text-faint">
            Title
            <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required placeholder="Analytics: first month" />
          </label>
          <label className="flex w-[140px] flex-col gap-1 text-[12px] text-faint">
            Amount (USD)
            <input className={`${field} font-mono`} value={usd} onChange={(e) => setUsd(e.target.value)} required inputMode="decimal" pattern="[0-9]{1,9}([.][0-9]{1,2})?" placeholder="1500" />
          </label>
          <label className="flex w-[110px] flex-col gap-1 text-[12px] text-faint">
            Valid (days)
            <input className={`${field} font-mono`} type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} required />
          </label>
          <label className="flex min-w-[min(100%,260px)] flex-1 flex-col gap-1 text-[12px] text-faint">
            Webhook URL (optional, https)
            <input className={`${field} font-mono`} type="url" value={hook} onChange={(e) => setHook(e.target.value)} placeholder="https://example.com/hooks/gully" />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-[12px] text-faint">
          Note for the customer (optional; shown on the pay page and the receipt)
          <textarea className={`${field} h-auto min-h-[64px] py-2`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </label>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-[12px] text-faint">Accepted assets</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {byChain(assets).map((g) => (
              <div key={g.chainId} className="flex flex-wrap items-center gap-2 font-mono text-[12px]">
                <span className="text-muted">{g.chain}</span>
                {g.assets.map((a) => (
                  <label key={a.id} className={`inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-btn border px-2 ${chosen.includes(a.id) ? 'border-gold text-gold' : 'border-line-strong text-ink-2'}`}>
                    <input type="checkbox" className="accent-gold" checked={chosen.includes(a.id)} onChange={() => toggle(a.id)} />
                    {a.symbol}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </fieldset>
        <div>
          <button type="submit" disabled={!chosen.length} className="h-10 rounded-btn bg-gold px-4 text-[14px] font-semibold text-bg hover:bg-gold-hover disabled:opacity-50">
            Create invoice
          </button>
        </div>
      </form>
      {secret && <SecretOnce secret={secret} onDone={() => setSecret(null)} />}
      {!invoices.length ? (
        <p className="m-0 text-[14px] text-muted">No invoices yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
                <th className="py-2 pr-3 font-medium">NO.</th>
                <th className="py-2 pr-3 font-medium">TITLE</th>
                <th className="py-2 pr-3 font-medium">USD</th>
                <th className="py-2 pr-3 font-medium">STATUS</th>
                <th className="py-2 pr-3 font-medium">EXPIRES</th>
                <th className="py-2 pr-3 font-medium">PAYMENT</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <Fragment key={i.id}>
                <tr className="border-b border-line last:border-b-0">
                  <td className="py-3 pr-3 font-mono text-[12px] text-faint">{i.number}</td>
                  <td className="py-3 pr-3 text-ink-2">
                    {i.title}
                    {i.linkId && <span className="ml-2 font-mono text-[11px] text-faint">via pay link</span>}
                    {i.webhook && <span className="ml-2 font-mono text-[11px] text-faint">webhook</span>}
                  </td>
                  <td className="py-3 pr-3 font-mono text-[12px]">{i.usd}</td>
                  <td className={`py-3 pr-3 font-mono text-[12px] uppercase ${STATUS_CLS[i.status]}`}>{i.status}</td>
                  <td className="py-3 pr-3 font-mono text-[12px] text-faint">{when(i.expiresAt)}</td>
                  <td className="py-3 pr-3 font-mono text-[12px]">
                    {i.payment ? (
                      <a href={i.payment.txUrl ?? undefined} target="_blank" rel="noopener noreferrer" className="text-ink-2 hover:text-gold">
                        {i.payment.amount} {i.payment.symbol} · {i.payment.chain}
                        <ArrowMark />
                      </a>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="py-3 text-right whitespace-nowrap">
                    <span className="inline-flex gap-2">
                      <button type="button" onClick={() => copy(i.path)} className={btn}>
                        Copy link
                      </button>
                      <a href={link(i.status === 'paid' ? `${i.path}/receipt` : i.path)} target="_blank" rel="noopener noreferrer" className={btn}>
                        {i.status === 'paid' ? 'Receipt' : 'Open'}
                        <ArrowMark />
                      </a>
                      <button type="button" onClick={() => setExtras(extras === i.id ? null : i.id)} className={btn} aria-expanded={extras === i.id}>
                        {extras === i.id ? 'Hide' : 'Embed & webhook'}
                      </button>
                      {(i.status === 'open' || i.status === 'expired') && (
                        <button
                          type="button"
                          onClick={() => window.confirm(`Cancel ${i.number} (${i.title})? Its link stops taking payments and its webhooks get invoice.cancelled.`) && act(`/api/admin/invoices/${i.id}/cancel`).then((e) => setMsg(e ? { ok: false, text: e } : { ok: true, text: `${i.number} cancelled.` }))}
                          className={`${btn} hover:border-error hover:text-error`}
                        >
                          Cancel
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
                {extras === i.id && (
                  <tr className="border-b border-line">
                    <td colSpan={7} className="py-3">
                      <InvoiceExtras token={token} invoice={i} reload={reload} onSecret={setSecret} />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function AdminPage() {
  const [token, setTok] = useState<string | null>(getToken)
  const { data, err, reload } = useAdmin(token)
  const signOut = () => {
    setToken(null)
    setTok(null)
  }
  useEffect(() => {
    document.title = 'Admin · Gully Labs'
    let m = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]')
    if (!m) {
      m = document.createElement('meta')
      m.name = 'robots'
      document.head.appendChild(m)
    }
    m.content = 'noindex, nofollow'
  }, [])

  if (!token || (err && (err.status === 401 || err.status === 503 || err.status === 429) && !data))
    return (
      <Login
        error={err?.message ?? null}
        onToken={(t) => {
          setToken(t)
          setTok(t)
        }}
      />
    )

  const act = async (path: string, body?: unknown): Promise<string | null> => {
    const r = await fetch(path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).catch(() => null)
    const d = r ? await r.json().catch(() => null) : null
    reload()
    return r?.ok ? null : (d?.error ?? 'The server could not be reached.')
  }

  const o = data?.overview
  const statusRows = o?.tracker.statuses ? Object.entries(o.tracker.statuses).sort((a, b) => b[1] - a[1]) : []
  const statusTotal = statusRows.reduce((a, [, n]) => a + n, 0)
  const statusColor: Record<string, string> = { 'in-line': '#aeb5be', premium: '#26ab94', discount: '#f2704a', drifting: '#d9b563', thin: '#5f6a78', 'no-pool': '#3a4656', 'pool-unreadable': '#ff8a7a', 'feed-unreadable': '#ff8a7a' }

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-[rgba(13,20,28,.9)] px-page py-4 backdrop-blur">
        <div className="flex items-center gap-4">
          <Link to="/" aria-label="Gully Labs home" className="text-ink">
            <Wordmark height={26} />
          </Link>
          <span className="rounded-full border border-gold-line px-3 py-[3px] font-mono text-[11px] text-gold">ADMIN</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className={small}>{o ? `updated ${ago(o.generatedAt)}` : 'loading…'}</span>
          <button type="button" onClick={() => reload()} className="inline-flex min-h-11 items-center gap-2 rounded-btn border border-line-strong px-3 font-mono text-[12px] text-ink-2 hover:border-gold">
            <RefreshCw size={16} aria-hidden />
            Refresh
          </button>
          <button type="button" onClick={signOut} className="inline-flex min-h-11 items-center gap-2 rounded-btn border border-line-strong px-3 font-mono text-[12px] text-ink-2 hover:border-gold">
            <LogOut size={16} aria-hidden />
            Sign out
          </button>
        </div>
        <AdminNav />
      </header>

      <main className="flex flex-col gap-5 px-page py-8">
        {err && data && <p className="m-0 rounded-input border border-error/40 px-4 py-3 font-mono text-[12px] text-error">Last refresh failed: {err.message}. Showing the previous read.</p>}
        <FeeProxyBanner s={o?.feeProxy} />
        <div id="health" className={sectionCls}>
          <HealthCard token={token} />
        </div>
        {!o ? (
          <p className="m-0 font-mono text-[13px] text-faint">Reading the server…</p>
        ) : (
          <>
            <div id="overview" className={sectionCls}>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,170px),1fr))] gap-px overflow-hidden rounded-card border border-line bg-line">
              <Tile k="API REQUESTS TODAY" v={((o.api.days.at(-1)?.anonymous ?? 0) + (o.api.days.at(-1)?.keyed ?? 0)).toLocaleString('en-US')} note={`${o.api.days.at(-1)?.limited ?? 0} rate-limited`} />
              <Tile k="ACCOUNTS" v={String(o.developers.accounts ?? 0)} note={`wallets · ${o.developers.liveKeys} live keys${o.developers.pending ? ` · ${o.developers.pending} legacy pending` : ''}`} tone={o.developers.pending ? '#d9b563' : undefined} />
              <Tile k="ENQUIRIES" v={String(o.enquiries.open)} note={`open of ${o.enquiries.total}`} tone={o.enquiries.open ? '#d9b563' : undefined} />
              <Tile k="LAUNCH LIST" v={String(o.launchList)} note="notify-me sign-ups" />
              <Tile k="TRACKER CACHE" v={o.tracker.cacheAgeSeconds === null ? '—' : `${o.tracker.cacheAgeSeconds}s`} note={`last snapshot ${ago(o.tracker.lastSnapshot)}`} />
              <Tile k="HISTORY" v={o.tracker.history.points.toLocaleString('en-US')} note={`points across ${o.tracker.history.series} series`} />
              <Tile k="PROCESS" v={`${o.process.rssMb} MB`} note={`up ${Math.round(o.process.uptimeSeconds / 3600)}h · ${o.process.node}`} />
            </div>

            <Suspense fallback={<ChartBox height={280} state="loading" />}>
              <AdminCharts token={token} />
            </Suspense>

            <FeeProxyCard s={o.feeProxy} act={act} />
            </div>

            <div id="traffic" className={sectionCls}>
            <div className="grid grid-cols-[1.4fr_1fr] gap-5 max-[1099px]:grid-cols-1">
              <section className={card}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className={h2}>API traffic</h2>
                  <span className={small}>origin requests per day · anonymous limit {o.api.anonymousLimitPerMin}/min</span>
                </div>
                <DayBars
                  days={o.api.days}
                  series={[
                    { key: 'anonymous', label: 'Anonymous', color: '#aeb5be' },
                    { key: 'keyed', label: 'With key', color: '#d9b563' },
                    { key: 'limited', label: 'Rate-limited', color: '#f2704a' },
                  ]}
                />
              </section>

              <section className={card}>
                <h2 className={h2}>Tracker health</h2>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {o.tracker.chains.map((c) => (
                    <li key={c.key} className="flex flex-wrap items-center justify-between gap-2 rounded-input border border-line px-3 py-2 text-[14px]">
                      <span className="flex items-center gap-2">
                        <i className={`size-2 rounded-full ${c.backoffUntil ? 'bg-error' : 'bg-green'}`} />
                        {c.name} <span className={small}>{c.stocks} stocks · {c.sessionOpen ? 'market open' : 'closed'}</span>
                      </span>
                      <span className={small}>{c.backoffUntil ? `backing off until ${when(c.backoffUntil)}` : `pools read ${ago(c.lastPoolRead)}`}</span>
                    </li>
                  ))}
                </ul>
                {statusTotal > 0 && (
                  <div className="flex flex-col gap-2">
                    <div className="flex h-3 overflow-hidden rounded-full bg-line">
                      {statusRows.map(([s, n], i) => (
                        <div key={s} title={`${s}: ${n}`} style={{ width: `${(n / statusTotal) * 100}%`, background: statusColor[s] ?? '#8a94a1', transformOrigin: 'left', animation: `gl-grow-x .7s ${i * 0.08}s cubic-bezier(.2,.8,.2,1) both` }} />
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {statusRows.map(([s, n]) => (
                        <span key={s} className="inline-flex items-center gap-2 font-mono text-[11px] text-muted">
                          <i className="inline-block size-[8px] rounded-[2px]" style={{ background: statusColor[s] ?? '#8a94a1' }} />
                          {s} {n}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <h2 className={`${h2} mt-2`}>Venues</h2>
                {o.venues.error ? (
                  <p className="m-0 text-[14px] text-error">{o.venues.error}</p>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {o.venues.list?.map((v) => (
                      <li key={v.key} className="flex items-center justify-between gap-2 text-[14px]">
                        <span className="flex items-center gap-2">
                          <i className={`size-2 rounded-full ${v.state === 'ok' ? 'bg-green' : 'bg-error'}`} />
                          {v.key}
                        </span>
                        <span className={`truncate font-mono text-[11px] ${v.state === 'ok' ? 'text-faint' : 'text-error'}`}>{v.state === 'ok' ? 'reading' : v.error}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
            </div>

            <div id="developers" className={sectionCls}>
            <section className={card}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className={h2}>Developer wallets</h2>
                <span className={small}>keys are self-serve; blocking a wallet stops all its keys and signs it out</span>
              </div>
              {!data.accounts.length ? (
                <p className="m-0 text-[14px] text-muted">No wallet has signed in yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[14px]">
                    <thead>
                      <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
                        <th className="py-2 pr-3 font-medium">WALLET</th>
                        <th className="py-2 pr-3 font-medium">KEYS</th>
                        <th className="py-2 pr-3 font-medium">FIRST SIGN-IN</th>
                        <th className="py-2 pr-3 font-medium">LAST SIGN-IN</th>
                        <th className="py-2 pr-3 font-medium">STATUS</th>
                        <th className="py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {data.accounts.map((a) => (
                        <tr key={a.address} className="border-b border-line last:border-b-0">
                          <td className="py-3 pr-3 font-mono text-[12px] text-ink-2">{a.address}</td>
                          <td className="py-3 pr-3 font-mono text-[12px]">
                            {a.liveKeys} live <span className="text-faint">/ {a.keys}</span>
                          </td>
                          <td className="py-3 pr-3 font-mono text-[12px] text-faint">{when(a.createdAt)}</td>
                          <td className="py-3 pr-3 font-mono text-[12px] text-faint">{ago(a.lastLoginAt)}</td>
                          <td className="py-3 pr-3 font-mono text-[12px]">{a.blocked ? <span className="text-error">blocked {when(a.blockedAt)}</span> : <span className="text-green">active</span>}</td>
                          <td className="py-3 text-right whitespace-nowrap">
                            {a.blocked ? (
                              <button type="button" onClick={() => act(`/api/admin/accounts/${a.address}/unblock`)} className="rounded-btn border border-line-strong px-3 py-[6px] text-[13px] text-ink-2 hover:border-gold hover:text-ink">
                                Unblock
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => window.confirm(`Block ${a.address}? Its ${a.liveKeys} live keys stop working and it is signed out.`) && act(`/api/admin/accounts/${a.address}/block`)}
                                className="rounded-btn border border-line-strong px-3 py-[6px] text-[13px] text-ink-2 hover:border-error hover:text-error"
                              >
                                Block
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {data.requests.length > 0 && (
            <section className={card}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className={h2}>Legacy key requests</h2>
                <span className={small}>the old manual flow, kept for requests already made; new keys are self-serve</span>
              </div>
              {!data.requests.length ? (
                <p className="m-0 text-[14px] text-muted">No requests yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[14px]">
                    <thead>
                      <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
                        <th className="py-2 pr-3 font-medium">PROJECT</th>
                        <th className="py-2 pr-3 font-medium">CONTACT</th>
                        <th className="py-2 pr-3 font-medium">USE</th>
                        <th className="py-2 pr-3 font-medium">RECEIVED</th>
                        <th className="py-2 pr-3 font-medium">STATUS</th>
                        <th className="py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {data.requests.map((r) => (
                        <tr key={r.id} className="border-b border-line align-top last:border-b-0">
                          <td className="py-3 pr-3">
                            <div className="font-medium">{r.project}</div>
                            {r.url && (
                              <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] text-gold">
                                {r.url.replace(/^https?:\/\//, '')}
                                <ArrowMark />
                              </a>
                            )}
                          </td>
                          <td className="py-3 pr-3 font-mono text-[12px] text-ink-2">{r.email}</td>
                          <td className="max-w-[360px] py-3 pr-3 text-[13px] text-muted">{r.use}</td>
                          <td className="py-3 pr-3 font-mono text-[12px] text-faint">{when(r.createdAt)}</td>
                          <td className="py-3 pr-3 font-mono text-[12px]">
                            <span className={r.status === 'pending' ? 'text-gold' : r.status === 'rejected' ? 'text-error' : 'text-green'}>{r.status}</span>
                            {r.claimedAt && <div className="text-faint">claimed {when(r.claimedAt)}</div>}
                          </td>
                          <td className="py-3 text-right whitespace-nowrap">
                            {r.status === 'pending' && (
                              <span className="flex justify-end gap-2">
                                <button type="button" onClick={() => act(`/api/admin/requests/${r.id}/approve`)} className="rounded-btn bg-gold px-3 py-[6px] text-[13px] font-semibold text-bg hover:bg-gold-hover">
                                  Approve
                                </button>
                                <button type="button" onClick={() => act(`/api/admin/requests/${r.id}/reject`)} className="rounded-btn border border-line-strong px-3 py-[6px] text-[13px] text-ink-2 hover:border-error hover:text-error">
                                  Reject
                                </button>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            )}

            <section className={card}>
                <h2 className={h2}>API keys</h2>
                {!data.keys.length ? (
                  <p className="m-0 text-[14px] text-muted">No keys issued yet.</p>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {data.keys.map((k) => {
                      const u = o.api.keys.find((x) => x.id === k.id)
                      return (
                        <li key={k.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-input border border-line px-3 py-2 ${k.revokedAt ? 'opacity-50' : ''}`}>
                          <span className="flex flex-col">
                            <span className="text-[14px]">{k.name ?? k.project}</span>
                            <span className={small}>
                              {k.prefix}… · {k.owner ? `${k.owner.slice(0, 6)}…${k.owner.slice(-4)}` : k.email} · {(u?.requests ?? 0).toLocaleString('en-US')} requests · last {ago(u?.lastUsed ?? null)}
                            </span>
                          </span>
                          {k.revokedAt ? (
                            <span className="font-mono text-[12px] text-faint">revoked {when(k.revokedAt)}</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => window.confirm(`Revoke ${k.name ?? k.project ?? 'this'} key? It stops working immediately.`) && act(`/api/admin/keys/${k.id}/revoke`)}
                              className="rounded-btn border border-line-strong px-3 py-[6px] text-[13px] text-ink-2 hover:border-error hover:text-error"
                            >
                              Revoke
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            </div>

            <div id="alerts" className={sectionCls}>
              <AlertsAdmin token={token} />
            </div>
            <div id="workspaces" className={sectionCls}>
              <WorkspacesAdmin token={token} />
            </div>
            <div id="security" className={sectionCls}>
              <SecurityCard token={token} />
            </div>
            <div id="telegram" className={sectionCls}>
              <TelegramChats token={token} />
              <TelegramChannel token={token} />
              <LaunchRadar token={token} />
              <TelegramBroadcasts token={token} />
            </div>
            <div id="billing" className={sectionCls}>
              <Subscriptions billing={data.billing} accounts={data.accounts} act={act} invoices={data.invoices.invoices} />
              <TreasurySafe token={token} />
            </div>
            <div id="pay" className={sectionCls}>
              <Invoices invoices={data.invoices.invoices} assets={data.invoices.assets} act={act} token={token} reload={reload} />
              <PayLinks token={token} />
              <MerchantsAdmin token={token} />
            </div>
            <div id="analytics" className={sectionCls}>
              <AnalyticsAccounts data={data.analytics} act={act} />
            </div>
            <div id="chainkit" className={sectionCls}>
              <ChainKitAdmin token={token} />
              <EcosystemSubmissions token={token} />
              <ChainsWaitlist token={token} />
            </div>

            <div id="inbox" className={sectionCls}>
            <div className="grid grid-cols-[1fr_1fr] gap-5 max-[1099px]:grid-cols-1">
              <section className={card}>
                <h2 className={h2}>Enquiries</h2>
                {!data.enquiries.length ? (
                  <p className="m-0 text-[14px] text-muted">No enquiries yet.</p>
                ) : (
                  <ul className="m-0 flex max-h-[520px] list-none flex-col gap-2 overflow-y-auto p-0">
                    {data.enquiries.map((e) => (
                      <li key={e.id} className={`flex flex-col gap-2 rounded-input border border-line px-3 py-3 ${e.handled ? 'opacity-50' : ''}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[14px]">
                            {e.name || 'No name'}{' '}
                            <a href={`mailto:${e.email}`} className="font-mono text-[12px] text-gold">
                              {e.email}
                            </a>
                          </span>
                          <span className={small}>{when(e.receivedAt)}</span>
                        </div>
                        <span className="font-mono text-[11px] text-faint">
                          {e.types.join(', ')}
                          {e.budget && ` · ${e.budget}`}
                        </span>
                        {e.message && <p className="m-0 text-[13px] leading-[1.5] whitespace-pre-wrap text-ink-2">{e.message}</p>}
                        <button type="button" onClick={() => act(`/api/admin/enquiries/${e.id}/handled`, { handled: !e.handled })} className="self-start bg-transparent p-0 font-mono text-[12px] text-faint hover:text-ink">
                          {e.handled ? 'Mark open' : 'Mark handled'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <section className={card}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className={h2}>Launch list</h2>
                <button
                  type="button"
                  onClick={async () => {
                    const r = await fetch('/api/admin/launch-list?format=csv', { headers: { authorization: `Bearer ${token}` } }).catch(() => null)
                    if (!r?.ok) {
                      const d = r ? await r.json().catch(() => null) : null
                      return toastError('The CSV could not be downloaded', { detail: d?.error ?? (r ? `HTTP ${r.status}` : 'The server could not be reached.') })
                    }
                    const url = URL.createObjectURL(await r.blob())
                    const a = document.createElement('a')
                    a.href = url
                    a.download = 'launch-list.csv'
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                  className="rounded-btn border border-line-strong px-3 py-[6px] font-mono text-[12px] text-ink-2 hover:border-gold"
                >
                  Export CSV
                </button>
              </div>
              {!data.launch.length ? (
                <p className="m-0 text-[14px] text-muted">Nobody has signed up yet.</p>
              ) : (
                <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2 p-0">
                  {data.launch.map((r) => (
                    <li key={r.email + r.slot} className="flex items-center justify-between gap-2 rounded-input border border-line px-3 py-2">
                      <span className="truncate font-mono text-[12px] text-ink-2">{r.email}</span>
                      <span className={small}>
                        {r.slot} · {when(r.addedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            </div>

            <div id="ai" className={sectionCls}>
              <AskStudio token={token} />
            </div>
          </>
        )}
      </main>
    </div>
  )
}
