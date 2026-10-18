import { AppWindow, ArrowRight, BellRing, Bot, Boxes, ChartNoAxesCombined, Check, Code2, CreditCard, KeyRound, Loader2, Network, Send, Store } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { NF } from '../../components/charts/number-formats'
import { toastError, toastSuccess } from '../../components/ui/toast'
import { DOCS_URL, isLocalHost, SITE_URL } from '../../site-host'
import { api, daysLeft, fmtDate, type Account, type AlertsView, type AnalyticsView, type BillingView, type Usage } from './api'
import { ExtLink } from './ExtLink'
import { firings, group } from './usage'
import { usePortal } from './portal'
import { Skeleton } from './parts'
import { input, mono, panel, pillGold, pillSm } from './styles'
import { KeySpark, LiveMarker, QuotaRing, StackedDays } from './vcharts'
import { useLoad, type Load } from './services/useLoad'
import type { ServiceTab } from './services/nav'

/* The Products tab: every Gully product in one hub, each card with its live state for the ACTIVE
   workspace and a live chart where data exists (a pulsing live marker where it does not yet; a
   figure the server does not know is "not tracked yet", never 0).
     Tracker API      /account (keys) + /usage?range=7d (requests sparkline)
     Alerts           /alerts (gap and DeepCore launch alerts, Telegram, firings from the delivery logs)
     Gully Analytics  /analytics (trial or plan, the events ring)
     Gully Pay        /billing (plan, payments to Gully); merchant stores in the Merchant tab (#merchant)
     Chain Kit        "Request your explorer": the site's enquiry endpoint (POST /api/contact)
     Gully Chains     the Devnet waitlist: the launch list (POST /api/notify, slot 90)
     Gully AI         /api/ask/status, and an inline question (POST /api/ask); recent questions stay in this browser
     Widget and SDK   links, with the API's live health */

const site = (path: string) => (isLocalHost() ? path : `${SITE_URL}${path}`)
const fmt = (n: number) => n.toLocaleString('en-US')
type Tab = 'keys' | 'alerts' | 'analytics' | 'billing' | ServiceTab
const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(k)
      return v ? (JSON.parse(v) as T) : d
    } catch {
      return d
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v))
    } catch {
      /* private mode */
    }
  },
}

function Card({ icon, title, badge, children, foot, id }: { icon: ReactNode; title: string; badge?: ReactNode; children: ReactNode; foot?: ReactNode; id?: string }) {
  return (
    <section id={id} className={`${panel} min-h-[260px] scroll-mt-4`} aria-label={title} data-product={title}>
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-line-strong text-gold">{icon}</span>
        <h2 className="m-0 flex-1 text-[15px] font-semibold">{title}</h2>
        {badge}
      </div>
      <div className="flex flex-1 flex-col gap-3">{children}</div>
      {foot && <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">{foot}</div>}
    </section>
  )
}

const pill = (t: string, tone: 'gold' | 'green' | 'dim' | 'red' = 'dim') => <span className={`rounded-full border px-2 py-[1px] font-mono text-[11px] ${tone === 'gold' ? 'border-gold-line text-gold' : tone === 'green' ? 'border-success-line text-green' : tone === 'red' ? 'border-[#5a2a24] text-error' : 'border-line-strong text-muted'}`}>{t}</span>

function Stat({ label, value, unknown }: { label: string; value: number | null; unknown?: string }) {
  return (
    <span className="flex min-w-[90px] flex-col">
      <span className="text-[11px] text-dim">{label}</span>
      {value === null ? <span className="font-mono text-[12px] text-faint">{unknown ?? 'not tracked yet'}</span> : <AnimatedNumber value={value} format={NF.int} countUp className="font-display text-[26px] leading-none font-bold" />}
    </span>
  )
}

const goBtn = (go: (t: Tab) => void, t: Tab, text: string) => (
  <button type="button" onClick={() => go(t)} className={pillSm}>
    {text} <ArrowRight size={14} aria-hidden />
  </button>
)

export function Products({ account, go }: { account: Account; go: (t: Tab) => void }) {
  const usage = useLoad<Usage>('/api/developer/usage?range=7d')
  const alerts = useLoad<AlertsView>('/api/developer/alerts')
  const ga = useLoad<AnalyticsView>('/api/developer/analytics')
  const bill = useLoad<BillingView>('/api/developer/billing')

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-[14px]" data-testid="products">
      <TrackerCard account={account} usage={usage} go={go} />
      <AlertsCard s={alerts} go={go} />
      <AnalyticsCard s={ga} go={go} />
      <PayCard s={bill} go={go} />
      <MerchantCard />
      <ChainKitCard />
      <ChainsCard />
      <AiCard go={go} />
      <WidgetCard go={go} />
    </div>
  )
}

function TrackerCard({ account, usage, go }: { account: Account; usage: Load<Usage>; go: (t: Tab) => void }) {
  const live = account.keys.filter((k) => !k.revokedAt)
  const g = useMemo(() => (usage.k === 'ok' ? group(usage.data) : null), [usage])
  const spark = useMemo(() => g?.map((b) => b.total) ?? [], [g])
  const labels = useMemo(() => g?.map((b) => new Date(b.t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', hour12: false })) ?? [], [g])
  const total = usage.k === 'ok' ? (usage.data.countingSince ? usage.data.rangeTotals.total : null) : null
  return (
    <Card icon={<KeyRound size={16} aria-hidden />} title="Tracker API" badge={pill(`${account.plan.name} plan`, account.plan.id === 'free' ? 'dim' : 'gold')} foot={goBtn(go, 'keys', live.length ? 'Manage keys' : 'Create a key')}>
      <div className="flex flex-wrap gap-4">
        <Stat label="Live keys" value={live.length} />
        <Stat label="Requests · 7d" value={total} unknown={usage.k === 'loading' ? '…' : 'not tracked yet'} />
        <Stat label="Limit / min / key" value={account.limits.keyPerMin} />
      </div>
      {usage.k === 'loading' ? <Skeleton h={56} /> : usage.k === 'ok' && usage.data.countingSince ? <KeySpark values={spark} labels={labels} color="#e8c060" width={300} height={56} label={`Requests over 7 days: ${fmt(total ?? 0)}`} /> : <LiveMarker text={live.length ? 'Waiting for your keys’ first request' : 'Create a key: its traffic charts here'} height={56} />}
    </Card>
  )
}

function AlertsCard({ s, go }: { s: Load<AlertsView>; go: (t: Tab) => void }) {
  const v = s.k === 'ok' ? s.data : null
  const days = useMemo(() => {
    if (!v) return []
    const from = new Date()
    from.setHours(0, 0, 0, 0)
    from.setDate(from.getDate() - 13)
    const f = firings(v, from.getTime())
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(from)
      d.setDate(from.getDate() + i)
      const n = f.filter((x) => new Date(x.at).toDateString() === d.toDateString()).length
      return { label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), values: { fired: n } }
    })
  }, [v])
  const gap = v ? v.alerts.filter((a) => a.condition.type !== 'deepcore-launch').length : null
  const launch = v ? v.alerts.filter((a) => a.condition.type === 'deepcore-launch').length : null
  const fired = days.reduce((a, d) => a + d.values.fired, 0)
  return (
    <Card icon={<BellRing size={16} aria-hidden />} title="Alerts" badge={v ? (v.telegram.linked ? pill('Telegram linked', 'green') : v.telegram.enabled ? pill('Telegram not linked') : pill('webhooks only')) : null} foot={goBtn(go, 'alerts', 'Open alerts')}>
      {s.k === 'error' ? (
        <LiveMarker text="Alerts: not readable right now" />
      ) : !v ? (
        <Skeleton h={120} />
      ) : (
        <>
          <div className="flex flex-wrap gap-4">
            <Stat label="Gap alerts" value={gap} />
            <Stat label="DeepCore launch" value={launch} />
            <Stat label="Fired · 14d" value={fired} />
          </div>
          {fired ? <StackedDays height={90} days={days} kinds={[{ id: 'fired', name: 'fired', color: '#6aa6ff' }]} label={`Alerts fired per day over 14 days: ${fired}.`} /> : <LiveMarker text={v.alerts.length ? 'Watching: firings chart here as they happen' : 'No alerts yet: set one on a gap or a DeepCore launch'} height={90} />}
        </>
      )}
    </Card>
  )
}

function AnalyticsCard({ s, go }: { s: Load<AnalyticsView>; go: (t: Tab) => void }) {
  const a = s.k === 'ok' ? s.data.account : null
  return (
    <Card
      icon={<ChartNoAxesCombined size={16} aria-hidden />}
      title="Gully Analytics"
      badge={a ? pill(a.state === 'trial' ? `trial · ${daysLeft(a.expiresAt) ?? '?'}d left` : a.state === 'active' ? (a.plan?.name ?? 'active') : 'ended', a.state === 'lapsed' ? 'red' : 'gold') : null}
      foot={goBtn(go, 'analytics', a ? 'Open analytics' : 'Start the free trial')}
    >
      {s.k === 'error' ? (
        <LiveMarker text="Gully Analytics: not readable right now" />
      ) : s.k === 'loading' ? (
        <Skeleton h={140} />
      ) : !a ? (
        <LiveMarker text={s.data.configured ? 'Web3-aware analytics: start a trial and your events ring fills here' : 'Self-serve sign-up is not switched on here yet'} height={120} />
      ) : a.plan ? (
        <div className="flex items-center gap-4">
          <QuotaRing caption="Events this month" quota={a.plan.eventsPerMonth} size={120} slices={a.sites.length ? a.sites.map((x, i) => ({ name: x.domain, value: x.eventsThisMonth, color: ['#e8c060', '#6aa6ff', '#6fcf6a', '#c58cff', '#4fd1c5'][i % 5] })) : [{ name: 'events', value: a.eventsThisMonth, color: '#e8c060' }]} />
          <div className="flex flex-col gap-2">
            <Stat label="Websites" value={a.sites.length} />
            <span className={mono}>{a.plan.sites} on the plan</span>
          </div>
        </div>
      ) : (
        <LiveMarker text={`No running plan · ${fmt(a.eventsThisMonth)} events this month`} height={120} />
      )}
    </Card>
  )
}

function PayCard({ s, go }: { s: Load<BillingView>; go: (t: Tab) => void }) {
  const v = s.k === 'ok' ? s.data : null
  const usd = v ? v.payments.reduce((t, p) => t + Number(p.usd ?? 0), 0) : null
  return (
    <Card icon={<CreditCard size={16} aria-hidden />} title="Gully Pay" badge={v ? pill(`${v.plan.name}${v.plan.expiresAt ? ` · until ${fmtDate(v.plan.expiresAt)}` : ''}`, v.plan.id === 'free' ? 'dim' : 'gold') : null} foot={goBtn(go, 'billing', 'Billing and receipts')}>
      {s.k === 'error' ? (
        <LiveMarker text="Billing: not readable right now" />
      ) : !v ? (
        <Skeleton h={120} />
      ) : (
        <>
          <div className="flex flex-wrap gap-4">
            <Stat label="Payments to Gully" value={v.payments.length} />
            <Stat label="Paid, USD" value={usd === null ? null : Math.round(usd)} />
          </div>
          {v.payments.length ? (
            <StackedDays height={90} days={[...v.payments].sort((a, b) => a.at.localeCompare(b.at)).map((p) => ({ label: fmtDate(p.at), values: { usd: Number(p.usd ?? 0) } }))} kinds={[{ id: 'usd', name: 'USD', color: '#6fcf6a' }]} label={`Payments over time: ${v.payments.length}.`} />
          ) : (
            <LiveMarker text="Pay for a plan from your wallet: payments chart here" height={90} />
          )}
        </>
      )}
    </Card>
  )
}

function MerchantCard() {
  return (
    <Card id="merchant" icon={<Store size={16} aria-hidden />} title="Merchant checkout" badge={pill('live', 'green')} foot={<a href="#merchant" className={pillSm}>Open your store <ArrowRight size={14} aria-hidden /></a>}>
      <p className="m-0 text-[13px] leading-[1.55] text-muted">Take crypto payments yourself: pay links, invoices and a “Pay with crypto” button with signed webhooks, run from this workspace.</p>
      <LiveMarker text="Non-custodial: payments go straight to your wallet. A fee per payment only, no monthly fee." />
    </Card>
  )
}

export function ChainKitCard() {
  const { me } = usePortal()
  const ws = me?.active
  const key = `gully:chainkit-requested:${ws?.id ?? ''}`
  const [done, setDone] = useState<string | null>(() => store.get<string | null>(key, null))
  const [email, setEmail] = useState(me?.profile.email ?? '')
  const [chain, setChain] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ws) return
    setBusy(true)
    const r = await api('/api/contact', {
      method: 'POST',
      body: { name: me?.profile.displayName ?? me?.address ?? '', email: email.trim(), types: ['Infrastructure'], budget: '', message: `Topic: Chain Kit — request an explorer\nChain: ${chain.trim() || '(not given)'}\nWorkspace: ${ws.name} (${ws.id})\nRequested by: ${me?.address}` },
    })
    setBusy(false)
    if (!r.ok) return toastError('The request could not be sent', { detail: r.status === 400 ? 'Check the email address.' : r.error })
    const at = new Date().toISOString()
    store.set(key, at)
    setDone(at)
    toastSuccess('Explorer requested', { detail: 'Gully Labs will write to you about your chain.' })
  }
  return (
    <Card icon={<Boxes size={16} aria-hidden />} title="Chain Kit" badge={done ? pill('requested', 'green') : pill('on request')} foot={<a href={site('/chain-kit')} className={pillSm}>What Chain Kit is <ArrowRight size={14} aria-hidden /></a>}>
      <p className="m-0 text-[13px] leading-[1.55] text-muted">A block explorer, faucet and status page for your chain, run for you.</p>
      {done ? (
        <p className="m-0 flex items-center gap-2 rounded-[10px] border border-success-line px-3 py-2 text-[13px] text-ink-2" data-testid="chainkit-requested">
          <Check size={15} className="text-green" aria-hidden /> Requested {fmtDate(done)} for {ws?.name}. We reply by email.
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <input className={input} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email to reach you" aria-label="Email" name="chainkit-email" />
          <input className={input} value={chain} onChange={(e) => setChain(e.target.value)} placeholder="Your chain (name, chain id, RPC)" aria-label="Your chain" maxLength={200} name="chainkit-chain" />
          <button type="submit" disabled={busy || !ws} className={pillGold}>
            {busy && <Loader2 size={15} className="animate-spin" aria-hidden />} Request your explorer
          </button>
        </form>
      )}
    </Card>
  )
}

function ChainsCard() {
  const { me } = usePortal()
  const [done, setDone] = useState<string | null>(() => store.get<string | null>('gully:devnet-waitlist', null))
  const [email, setEmail] = useState(me?.profile.email ?? '')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const r = await api<{ alreadyOnList?: boolean }>('/api/notify', { method: 'POST', body: { email: email.trim(), slot: '90' } })
    setBusy(false)
    if (!r.ok) return toastError('Could not join the waitlist', { detail: r.error })
    const at = new Date().toISOString()
    store.set('gully:devnet-waitlist', at)
    setDone(at)
    toastSuccess(r.data.alreadyOnList ? 'Already on the Devnet waitlist' : 'You are on the Devnet waitlist', { detail: email.trim() })
  }
  return (
    <Card icon={<Network size={16} aria-hidden />} title="Gully Chains" badge={done ? pill('on the waitlist', 'green') : pill('soon', 'gold')}>
      <p className="m-0 text-[13px] leading-[1.55] text-muted">App chains, launched for you. The Gully Devnet opens to the waitlist first.</p>
      <LiveMarker text="Gully Devnet: in development" height={48} />
      {done ? (
        <p className="m-0 flex items-center gap-2 text-[13px] text-ink-2" data-testid="devnet-joined">
          <Check size={15} className="text-green" aria-hidden /> Joined {fmtDate(done)}. We email you when it opens.
        </p>
      ) : (
        <form onSubmit={submit} className="flex gap-2 max-[420px]:flex-col">
          <input className={input} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-label="Email for the Devnet waitlist" name="devnet-email" />
          <button type="submit" disabled={busy} className={`${pillGold} shrink-0`}>
            Join the waitlist
          </button>
        </form>
      )}
    </Card>
  )
}

type Asked = { q: string; a: string; at: string }

function AiCard({ go }: { go: (t: Tab) => void }) {
  const [status, setStatus] = useState<boolean | null | 'error'>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [recent, setRecent] = useState<Asked[]>(() => store.get<Asked[]>('gully:ask-recent', []))
  useEffect(() => {
    let alive = true
    api<{ configured: boolean }>('/api/ask/status').then((r) => alive && setStatus(r.ok ? !!r.data.configured : 'error'))
    return () => {
      alive = false
    }
  }, [])
  const ask = async (e: FormEvent) => {
    e.preventDefault()
    const question = q.trim()
    if (!question) return
    setBusy(true)
    const r = await api<{ answer: string }>('/api/ask', { method: 'POST', body: { question } })
    setBusy(false)
    if (!r.ok) return toastError('Gully AI could not answer', { detail: r.error })
    const next = [{ q: question, a: r.data.answer, at: new Date().toISOString() }, ...recent].slice(0, 5)
    setRecent(next)
    store.set('gully:ask-recent', next)
    setQ('')
  }
  return (
    <Card icon={<Bot size={16} aria-hidden />} title="Gully AI" badge={status === true ? pill('online', 'green') : status === false ? pill('not switched on') : null} foot={goBtn(go, 'ai', 'Open Gully AI')}>
      {status === null ? (
        <Skeleton h={44} />
      ) : status === true ? (
        <form onSubmit={ask} className="flex gap-2">
          <input className={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about the data or the API…" maxLength={500} aria-label="Ask Gully AI" name="ask" />
          <button type="submit" disabled={busy || !q.trim()} className={`${pillGold} shrink-0`} aria-label="Ask">
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Send size={15} aria-hidden />}
          </button>
        </form>
      ) : (
        <LiveMarker text={status === 'error' ? 'Gully AI status: not readable right now' : 'Gully AI is not switched on on this server yet'} height={44} />
      )}
      {recent.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {recent.slice(0, 3).map((r) => (
            <li key={r.at} className="flex flex-col gap-1 rounded-[10px] border border-line px-3 py-2">
              <b className="text-[13px] font-semibold">{r.q}</b>
              <span className="line-clamp-3 text-[12px] leading-[1.5] text-muted">{r.a}</span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-[12px] text-faint">Your recent questions appear here (kept in this browser).</span>
      )}
    </Card>
  )
}

function WidgetCard({ go }: { go: (t: Tab) => void }) {
  const [up, setUp] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/healthz', { cache: 'no-store' })
      .then((r) => alive && setUp(r.ok))
      .catch(() => alive && setUp(false))
    return () => {
      alive = false
    }
  }, [])
  return (
    <Card icon={<AppWindow size={16} aria-hidden />} title="Widget builder and SDK" badge={up === null ? null : up ? pill('API up', 'green') : pill('API unreachable', 'red')}>
      <p className="m-0 text-[13px] leading-[1.55] text-muted">Live fair prices on any page with two lines of HTML, no key; or the typed TypeScript client for your server.</p>
      <LiveMarker text={up === null ? 'Checking the API…' : up ? 'Public API answering now' : 'The API did not answer the health check'} height={48} />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => go('widgets')} className={pillSm}>
          <AppWindow size={14} aria-hidden /> Widget builder
        </button>
        <ExtLink href={`${DOCS_URL}/sdk`} className={pillSm}>
          <Code2 size={14} aria-hidden /> SDK docs
        </ExtLink>
      </div>
    </Card>
  )
}
