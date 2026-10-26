import { AppWindow, ArrowRight, BellRing, Bot, ChartNoAxesCombined, Code2, CreditCard, Gauge, KeyRound, Loader2, Send, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { GhostChart } from '../../components/charts/GhostChart'
import { MiniBars } from '../../components/charts/MiniBars'
import { MiniSpark } from '../../components/charts/MiniSpark'
import { NF } from '../../components/charts/number-formats'
import { toastError } from '../../components/ui/toast'
import { DOCS_URL, securityPrimary } from '../../site-host'
import { ProductHub } from '../../console/Handoff'
import { api, daysLeft, fmtDate, type Account, type AlertsView, type AnalyticsView, type BillingView, type Usage } from './api'
import { ExtLink } from './ExtLink'
import { firings, group } from './usage'
import { Skeleton } from './parts'
import { input, mono, panel, pillGold, pillSm } from './styles'
import { usePoll } from './poll'
import { RefreshChip, Unknown } from './ui'
import { KeySpark, QuotaRing, StackedDays } from './vcharts'
import type { Load } from './services/useLoad'
import type { ServiceTab } from './services/nav'
import type { ScanView } from '../../components/security/types'
import { bandColor, useJson, type ScoreIndex } from '../score/api'
import { StatusPill as KitPill } from '../../components/ui/StatusPill'

/* The Products tab: every Gully product in one hub, each card with its live state for the ACTIVE
   workspace and a live chart where data exists (a pulsing live marker where it does not yet; a
   figure the server does not know is "not tracked yet", never 0).
     Tracker API      /account (keys) + /usage?range=7d (requests sparkline)
     Alerts           /alerts (gap and DeepCore launch alerts, Telegram, firings from the delivery logs)
     Gully Analytics  /analytics (trial or plan, the events ring)
     Gully Pay        /billing (plan, payments to Gully)
     Gully AI         /api/ask/status, and an inline question (POST /api/ask); recent questions stay in this browser
     Gully Security   the workspace's scans, until SECURITY_PRIMARY hands Security to its own app
   Above them, the six Gully products on their own domains (Gully Chain, Gully Pay, Gully RPC, HolderMaps, Gully
   Security, Gully Studio), each a card with one live figure that opens the product (console/Handoff.tsx).
     Widget and SDK   links, with the API's live health
   Every read is polled with backoff and keeps its last good answer (a failed refresh shows a retry chip);
   a first read that does not answer in time reads as "not available right now", never as 0. Cards are
   compact (12px padding, 8px gaps) so the whole hub fits one screen at 1440×900. */

const fmt = (n: number) => n.toLocaleString('en-US')
type Tab = 'keys' | 'alerts' | 'analytics' | 'billing' | 'security' | ServiceTab
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
    <section id={id} className={`${panel} scroll-mt-4 gap-2 p-3`} aria-label={title} data-product={title}>
      <div className="flex items-center gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-[9px] border border-line-strong text-gold">{icon}</span>
        <h2 className="m-0 flex-1 text-[14px] font-semibold">{title}</h2>
        {badge}
      </div>
      <div className="flex flex-1 flex-col gap-2">{children}</div>
      {foot && <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">{foot}</div>}
    </section>
  )
}

/** usePoll as the Load shape the cards take; a first read with no answer in time becomes an error. */
function useCard<T>(path: string, every: number): Load<T> & { refreshErr: string | null; retry: () => void } {
  const p = usePoll<T>(path, every)
  const retry = () => void p.reload()
  if (p.data) return { k: 'ok', data: p.data, refreshErr: p.error, retry }
  if (p.error || p.timedOut) return { k: 'error', message: p.error ?? 'no answer in time', refreshErr: null, retry }
  return { k: 'loading', refreshErr: null, retry }
}

/** A card's empty or unreadable chart: the kit's ghost curve with the words on it (never a dot and a sentence). */
function LiveMarker({ text, height = 64 }: { text: string; height?: number }) {
  return <GhostChart variant="line" height={height} label={text} badge={false} />
}

const PILL_TONE = { gold: 'warn', green: 'ok', dim: 'neutral', red: 'error' } as const
const pill = (t: string, tone: keyof typeof PILL_TONE = 'dim') => <KitPill tone={PILL_TONE[tone]}>{t}</KitPill>

function Stat({ label, value, unknown }: { label: string; value: number | null; unknown?: string }) {
  return (
    <span className="flex min-w-[90px] flex-col">
      <span className="text-[11px] text-dim">{label}</span>
      {value === null ? <span className="font-mono text-[12px] text-faint">{unknown ?? 'not tracked yet'}</span> : <AnimatedNumber value={value} format={NF.int} countUp className="font-display text-[22px] leading-none font-bold" />}
    </span>
  )
}

const goBtn = (go: (t: Tab) => void, t: Tab, text: string) => (
  <button type="button" onClick={() => go(t)} className={`${pillSm} min-h-11`}>
    {text} <ArrowRight size={14} aria-hidden />
  </button>
)

export function Products({ account, go }: { account: Account; go: (t: Tab) => void }) {
  const usage = useCard<Usage>('/api/developer/usage?range=7d', 60_000)
  const alerts = useCard<AlertsView>('/api/developer/alerts', 60_000)
  const ga = useCard<AnalyticsView>('/api/developer/analytics', 120_000)
  const bill = useCard<BillingView>('/api/developer/billing', 120_000)
  const failed = [usage, alerts, ga, bill].find((x) => x.refreshErr)

  return (
    <div className="flex flex-col gap-2">
    <h2 className="m-0 font-mono text-[11px] font-normal tracking-[1px] text-faint uppercase">Gully products · each on its own domain</h2>
    <ProductHub />
    <h2 className="m-0 mt-2 font-mono text-[11px] font-normal tracking-[1px] text-faint uppercase">In this workspace</h2>
    {failed && <RefreshChip error={failed.refreshErr} onRetry={() => [usage, alerts, ga, bill].forEach((x) => x.refreshErr && x.retry())} className="self-start" />}
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] items-stretch gap-2" data-testid="products">
      <TrackerCard account={account} usage={usage} go={go} />
      <AlertsCard s={alerts} go={go} />
      <AnalyticsCard s={ga} go={go} />
      <PayCard s={bill} go={go} />
      <AiCard go={go} />
      {!securityPrimary() && <SecurityCard go={go} />}
      <ScoreCard go={go} />
      <WidgetCard go={go} />
    </div>
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
      <div className="flex flex-wrap gap-3">
        <Stat label="Live keys" value={live.length} />
        <Stat label="Requests · 7d" value={total} unknown={usage.k === 'loading' ? '…' : usage.k === 'error' ? 'not available right now' : 'not tracked yet'} />
        <Stat label="Limit / min / key" value={account.limits.keyPerMin} />
      </div>
      {usage.k === 'loading' ? <Skeleton h={44} /> : usage.k === 'ok' && usage.data.countingSince ? <KeySpark values={spark} labels={labels} color="#00d2ff" width={300} height={44} label={`Requests over 7 days: ${fmt(total ?? 0)}`} /> : usage.k === 'error' ? <LiveMarker text="Usage: not available right now" height={44} /> : <LiveMarker text={live.length ? 'Waiting for your keys’ first request' : 'Create a key: its traffic charts here'} height={44} />}
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
        <Skeleton h={90} />
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <Stat label="Gap alerts" value={gap} />
            <Stat label="DeepCore launch" value={launch} />
            <Stat label="Fired · 14d" value={fired} />
          </div>
          {fired ? <StackedDays height={64} days={days} kinds={[{ id: 'fired', name: 'fired', color: '#248bff' }]} label={`Alerts fired per day over 14 days: ${fired}.`} /> : <LiveMarker text={v.alerts.length ? 'Watching: firings chart here as they happen' : 'No alerts yet: set one on a gap or a DeepCore launch'} height={64} />}
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
      badge={a ? pill(a.state === 'trial' ? (daysLeft(a.expiresAt) === null ? 'trial · end date not tracked yet' : `trial · ${daysLeft(a.expiresAt)}d left`) : a.state === 'active' ? (a.plan?.name ?? 'active') : 'ended', a.state === 'lapsed' ? 'red' : 'gold') : null}
      foot={goBtn(go, 'analytics', a ? 'Open analytics' : 'Start the free trial')}
    >
      {s.k === 'error' ? (
        <LiveMarker text="Gully Analytics: not readable right now" />
      ) : s.k === 'loading' ? (
        <Skeleton h={88} />
      ) : !a ? (
        <LiveMarker text={s.data.configured ? 'Web3-aware analytics: start a trial and your events ring fills here' : 'Analytics is not available on this server yet'} height={64} />
      ) : a.plan ? (
        <div className="flex items-center gap-3">
          <QuotaRing caption="Events this month" quota={a.plan.eventsPerMonth} size={88} slices={a.sites.length ? a.sites.map((x, i) => ({ name: x.domain, value: x.eventsThisMonth, color: ['#00d2ff', '#248bff', '#3ddc97', '#9578e8', '#20a0c4'][i % 5] })) : [{ name: 'events', value: a.eventsThisMonth, color: '#00d2ff' }]} />
          <div className="flex flex-col gap-2">
            <Stat label="Websites" value={a.sites.length} />
            <span className={mono}>{a.plan.sites} on the plan</span>
          </div>
        </div>
      ) : (
        <LiveMarker text={`No running plan · ${fmt(a.eventsThisMonth)} events this month`} height={64} />
      )}
    </Card>
  )
}

function PayCard({ s, go }: { s: Load<BillingView>; go: (t: Tab) => void }) {
  const v = s.k === 'ok' ? s.data : null
  // Only payments with a recorded USD value are added; an unknown one is never counted as $0.
  const usdOf = (u: string | null | undefined) => (u === null || u === undefined || u === '' ? null : Number.isFinite(Number(u)) ? Number(u) : null)
  const known = v ? v.payments.filter((p) => usdOf(p.usd) !== null) : []
  const usd = known.length ? known.reduce((t, p) => t + (usdOf(p.usd) ?? 0), 0) : null
  const partial = !!v && known.length < v.payments.length
  return (
    <Card icon={<CreditCard size={16} aria-hidden />} title="Gully Pay" badge={v ? pill(`${v.plan.name}${v.plan.expiresAt ? ` · until ${fmtDate(v.plan.expiresAt)}` : ''}`, v.plan.id === 'free' ? 'dim' : 'gold') : null} foot={goBtn(go, 'billing', 'Billing and receipts')}>
      {s.k === 'error' ? (
        <LiveMarker text="Billing: not readable right now" />
      ) : !v ? (
        <Skeleton h={90} />
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <Stat label="Payments to Gully" value={v.payments.length} />
            {v.payments.length && usd === null ? (
              <span className="flex min-w-[90px] flex-col">
                <span className="text-[11px] text-dim">Paid, USD</span>
                <Unknown className="font-display text-[22px] leading-none font-bold" />
              </span>
            ) : (
              <Stat label={partial ? 'Paid, USD · partial' : 'Paid, USD'} value={usd === null ? 0 : Math.round(usd)} />
            )}
          </div>
          {known.length ? (
            <StackedDays height={64} days={[...known].sort((a, b) => a.at.localeCompare(b.at)).map((p) => ({ label: fmtDate(p.at), values: { usd: usdOf(p.usd) ?? 0 } }))} kinds={[{ id: 'usd', name: 'USD', color: '#3ddc97' }]} label={`Payments over time: ${known.length} with a USD value${partial ? ' (partial)' : ''}.`} />
          ) : (
            <LiveMarker text={v.payments.length ? 'USD values not recorded for these payments' : 'Pay for a plan from your wallet: payments chart here'} height={64} />
          )}
        </>
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
          <input className={`${input} h-9 text-[14px]`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about the data or the API…" maxLength={500} aria-label="Ask Gully AI" name="ask" />
          <button type="submit" disabled={busy || !q.trim()} className={`${pillGold} min-h-11 shrink-0`} aria-label="Ask">
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Send size={15} aria-hidden />}
          </button>
        </form>
      ) : (
        <LiveMarker text={status === 'error' ? 'Gully AI status: not readable right now' : 'Gully AI is not switched on on this server yet'} height={44} />
      )}
      {recent.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {recent.slice(0, 2).map((r) => (
            <li key={r.at} className="flex flex-col gap-[2px] rounded-[10px] border border-line px-3 py-[6px]">
              <b className="truncate text-[13px] font-semibold">{r.q}</b>
              <span className="line-clamp-2 text-[12px] leading-[1.45] text-muted">{r.a}</span>
            </li>
          ))}
        </ul>
      ) : (
        <LiveMarker text="Your questions will chart here (kept in this browser)" height={48} />
      )}
    </Card>
  )
}


/** Holder Map: the newest checked launches as a health-score chart and a short list (GET /api/holders/launches, every 30 s). */
/** Gully Security: the workspace's scans, per day for the last week (GET /api/developer/security/scans). */
function SecurityCard({ go }: { go: (t: Tab) => void }) {
  const s = useCard<{ scans: ScanView[] }>('/api/developer/security/scans', 60_000)
  const scans = s.k === 'ok' ? s.data.scans : null
  const bars = useMemo(() => {
    if (!scans) return []
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today)
      d.setDate(today.getDate() - (6 - i))
      return { label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), value: scans.filter((x) => new Date(x.createdAt).toDateString() === d.toDateString()).length }
    })
  }, [scans])
  return (
    <Card icon={<ShieldCheck size={16} aria-hidden />} title="Gully Security" badge={scans ? pill(`${scans.length} scan${scans.length === 1 ? '' : 's'}`, scans.length ? 'gold' : 'dim') : null} foot={goBtn(go, 'security', 'Open Security')}>
      <p className="m-0 text-[13px] leading-[1.55] text-muted">Scan a contract or a code upload, keep a signed report, and watch deployed contracts for changes.</p>
      {s.k === 'error' ? <LiveMarker text="Security: not readable right now" /> : !scans ? <Skeleton h={64} /> : <MiniBars bars={bars} label={`Security scans per day over the last 7 days: ${scans.length} in total.`} height={64} emptyLabel="No scan yet: your scans chart here" />}
    </Card>
  )
}

/** Gully Score: how the listed contracts spread over the four bands (GET /api/score). */
function ScoreCard({ go }: { go: (t: Tab) => void }) {
  const [s] = useJson<ScoreIndex>('/api/score', 120_000)
  const d = s.state === 'ok' ? s.data : null
  const bars = useMemo(() => {
    if (!d) return []
    const band = (name: string, color: string, test: (n: number) => boolean) => ({ label: name, color, value: d.scores.filter((r) => r.score !== null && test(r.score)).length })
    return [band('Strong 80+', bandColor(90), (n) => n >= 80), band('Fair 60–79', bandColor(70), (n) => n >= 60 && n < 80), band('Weak 40–59', bandColor(50), (n) => n >= 40 && n < 60), band('Poor <40', bandColor(10), (n) => n < 40)]
  }, [d])
  return (
    <Card icon={<Gauge size={16} aria-hidden />} title="Gully Score" badge={d ? pill(`${d.scores.length} listed`, d.scores.length ? 'gold' : 'dim') : null} foot={goBtn(go, 'score', 'Open Gully Score')}>
      <p className="m-0 text-[13px] leading-[1.55] text-muted">A 0 to 100 reading of how a contract is controlled and has behaved, from public evidence only.</p>
      {s.state === 'error' ? <LiveMarker text="Score: not readable right now" /> : !d ? <Skeleton h={64} /> : <MiniBars bars={bars} orientation="rows" label={`Listed contracts by Gully Score band: ${d.scores.length} listed.`} emptyLabel="No contract is listed yet" />}
    </Card>
  )
}

/** The public API's answer time: GET /healthz every 20 s, the last 20 readings charted. */
function useApiPulse() {
  const [ms, setMs] = useState<number[]>([])
  const [up, setUp] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    const ping = () => {
      const t0 = performance.now()
      fetch('/healthz', { cache: 'no-store' })
        .then((r) => {
          if (!alive) return
          setUp(r.ok)
          if (r.ok) setMs((a) => [...a, Math.round(performance.now() - t0)].slice(-20))
        })
        .catch(() => alive && setUp(false))
    }
    ping()
    const id = setInterval(() => document.visibilityState !== 'hidden' && ping(), 20_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  return { up, ms }
}

function WidgetCard({ go }: { go: (t: Tab) => void }) {
  const { up, ms } = useApiPulse()
  return (
    <Card icon={<AppWindow size={16} aria-hidden />} title="Widget builder and SDK" badge={up === null ? null : up ? pill('API online', 'green') : pill('API unreachable', 'red')}>
      <span className="text-[12px] text-dim">Live fair prices on any page with two lines of HTML, no key; or the typed SDK.</span>
      {up === false ? <LiveMarker text="The API did not answer the health check" height={48} /> : <MiniSpark data={ms} label={`API answer time in milliseconds, last ${ms.length} checks`} fmt={(v) => `${v} ms`} height={48} color="#3ddc97" />}
      <span className="font-mono text-[11px] text-faint">{up === null ? 'Checking the API…' : up ? `Answer time, checked every 20 s${ms.length ? ` · now ${ms[ms.length - 1]} ms` : ''}` : ''}</span>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => go('widgets')} className={`${pillSm} min-h-11`}>
          <AppWindow size={14} aria-hidden /> Widget builder
        </button>
        <ExtLink href={`${DOCS_URL}/sdk`} className={`${pillSm} min-h-11`}>
          <Code2 size={14} aria-hidden /> SDK docs
        </ExtLink>
      </div>
    </Card>
  )
}
