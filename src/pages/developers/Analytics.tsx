import { AlertTriangle, ArrowUpRight, ChartNoAxesCombined, Check, CheckCircle2, Code2, CreditCard, Globe, KeyRound, Loader2, Plus, Receipt, RotateCw, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { CodeBlock } from '../../docs/CodeBlock'
import { DOCS_URL } from '../../site-host'
import { api, daysLeft, fmtDate, shortAddress, type AnalyticsAccount, type AnalyticsPlan, type AnalyticsSite, type AnalyticsUsage, type AnalyticsView, type Payment, type Quote } from './api'
import { GhostCurves, Meter } from './charts'
import { AnalyticsTraffic } from './tabcharts'
import { BLOCK_TEXT, siteMeta, type SiteUsage } from './helpers'
import { CopyButton, Dialog } from './Dialog'
import { ErrorLine, Skeleton } from './parts'
import { usePoll } from './poll'
import { useSubTab } from './subtab'
import { InfoTip, KpiRow, KpiTile, RefreshChip, Stepper, SubPanel, SubTabs, Unknown } from './ui'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { ExtLink } from './ExtLink'
import { OpenAnalytics } from './OpenAnalytics'
import { Can } from './RoleGate'
import { ChainLogo } from '../../components/logos/ChainLogo'
import { KEY_COLORS } from './styles'
import { QuotaRing } from './vcharts'
import { PayFlow } from './PayFlow'
import { input, mono, panel, panelTitle, pillDanger, pillGold, pillLine, pillSm, rise } from './styles'
import { toastError, toastSuccess } from '../../components/ui/toast'

/* Gully Analytics, self-serve: start a free trial (the server creates a Gully Analytics login for this
   wallet and shows its password once), add websites, copy the install snippet (with data-web3), watch
   this month's events against the plan, and buy or extend a plan with Gully Pay. Every plan figure comes
   from the server (GET /api/developer/analytics, which reads server/plans.mjs); nothing is priced here. */

const n = (v: number) => v.toLocaleString('en-US')
/** A compact secondary action (36px on desktop, 44px touch targets on narrow screens). */
const rowPill = 'inline-flex min-h-9 items-center gap-[6px] rounded-full border border-line-strong px-3 text-[12px] text-ink-2 transition-colors hover:border-gold hover:text-ink max-[859px]:min-h-11'

const snippet = (origin: string, id: string) => `<script defer src="${origin}/script.js"\n  data-website-id="${id}"\n  data-web3="true"></script>`

type Secret = { username: string; password: string; first: boolean } | null

function PasswordDialog({ secret, loginUrl, onClose }: { secret: Secret; loginUrl: string; onClose: () => void }) {
  return (
    <Dialog open={!!secret} onClose={onClose} title={secret?.first ? 'Your Gully Analytics login' : 'Your new password'} dismissable={false}>
      {secret ? (
        <div className="flex flex-col gap-4">
          <p className="m-0 flex items-start gap-3 rounded-[10px] border border-gold-line bg-[rgba(217,181,99,.06)] px-4 py-3 text-[14px] leading-[1.55] text-ink-2">
            <AlertTriangle size={18} className="mt-[2px] shrink-0 text-gold" aria-hidden />
            Copy the password now. It is shown this once and we do not keep it. Lost it? Reset it from this tab.
          </p>
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11px] tracking-[1px] text-faint">USERNAME</span>
            <div className="flex items-center gap-2 rounded-[10px] border border-line bg-bg py-1 pr-1 pl-3">
              <code className="min-w-0 flex-1 font-mono text-[13px] break-all text-ink">{secret.username}</code>
              <CopyButton text={secret.username} what="Username" />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11px] tracking-[1px] text-faint">PASSWORD</span>
            <div className="flex items-center gap-2 rounded-[10px] border border-gold-line bg-bg py-1 pr-1 pl-3">
              <code className="min-w-0 flex-1 font-mono text-[13px] break-all text-gold" data-testid="analytics-password">
                {secret.password}
              </code>
              <CopyButton text={secret.password} what="Password" />
            </div>
          </div>
          <ExtLink href={loginUrl} className="inline-flex min-h-11 items-center gap-1 font-mono text-[12px] text-muted hover:text-gold">
            Sign in at {loginUrl.replace(/^https:\/\//, '')}
          </ExtLink>
          <div className="flex justify-end">
            <button type="button" data-autofocus onClick={onClose} className={pillGold}>
              <Check size={16} aria-hidden /> I have saved it
            </button>
          </div>
        </div>
      ) : null}
    </Dialog>
  )
}

/** This month's events against the plan, as in the design: "37,420 / 100,000 events" and a gold bar. */
export function EventsMeter({ account }: { account: AnalyticsAccount }) {
  if (!account.plan)
    return (
      <span className="font-mono text-[12px] text-muted">
        <b className="font-medium text-ink">{n(account.eventsThisMonth)}</b> events this month · no running plan
      </span>
    )
  const pct = (account.eventsThisMonth / Math.max(1, account.plan.eventsPerMonth)) * 100
  return (
    <div className="flex flex-col gap-2">
      <span className="flex flex-wrap items-baseline justify-between gap-2 font-mono text-[11px] text-dim">
        <span>
          <b className="font-medium text-ink">{n(account.eventsThisMonth)}</b> / {n(account.plan.eventsPerMonth)} events
        </span>
        <span className={pct >= 100 ? 'text-error' : ''}>{pct >= 100 ? 'limit reached' : `${pct < 1 && pct > 0 ? '<1' : Math.round(pct)}% · ${new Date(account.monthStart).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })} (UTC)`}</span>
      </span>
      <Meter value={account.eventsThisMonth} max={account.plan.eventsPerMonth} label="Events this month against the plan" tone={pct >= 100 ? '#ff8a7a' : undefined} />
    </div>
  )
}

function StartStep({ view, onStarted }: { view: AnalyticsView; onStarted: (s: Secret) => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const trial = view.offer.analytics.plans.find((p) => p.id === 'trial')
  const start = async () => {
    setBusy(true)
    setErr(null)
    const r = await api<{ account: AnalyticsAccount; password: string }>('/api/developer/analytics/start', { method: 'POST' })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    toastSuccess('Free trial started', { detail: 'Copy your Gully Analytics password now, it is shown once.' })
    onStarted({ username: r.data.account.username, password: r.data.password, first: true })
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {view.trialAvailable && trial ? (
          <ul className="m-0 flex min-w-0 flex-[1_1_320px] list-none flex-wrap gap-x-4 gap-y-1 p-0 font-mono text-[12px] text-muted">
            {[
              [`${view.offer.analytics.trialDays} days`, 'free, no payment'],
              [`${trial.sites} website${trial.sites === 1 ? '' : 's'}`, 'with Web3 tracking'],
              [`${n(trial.eventsPerMonth)}`, 'events a month'],
            ].map(([v, l]) => (
              <li key={l}>
                <b className="font-medium text-ink">{v}</b> {l}
              </li>
            ))}
          </ul>
        ) : (
          <span className="min-w-0 flex-[1_1_320px] text-[13px] text-muted">This wallet has had its free trial. Create a login again and choose a plan to start recording.</span>
        )}
        <Can cat="analytics" what="start Gully Analytics">
          <button type="button" onClick={start} disabled={busy || !view.configured} className={pillGold}>
            {busy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <ChartNoAxesCombined size={17} aria-hidden />}
            {busy ? 'Creating your login…' : view.trialAvailable ? 'Start free trial' : 'Create my login'}
          </button>
        </Can>
      </div>
      {!view.configured && (
        <p className="m-0 text-[13px] text-faint" role="status">
          Self-serve sign-up is not switched on on this server yet. Write to hello@gullylabs.xyz for early access.
        </p>
      )}
      <GhostCurves height={120} title="Your page views and visitors will draw here">
        <span className="max-w-[460px] text-[12px] text-muted">Once a website of yours records, its last 30 days chart here, read live from Gully Analytics.</span>
      </GhostCurves>
      {err && <ErrorLine>{err}</ErrorLine>}
    </div>
  )
}

function SiteRow({ site, origin, usage, share, onDelete }: { site: AnalyticsSite; origin: string; usage: SiteUsage; share: number; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="flex flex-col gap-2 border-t border-line pt-2 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex min-w-0 flex-[1_1_220px] flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <Globe size={14} className="shrink-0 text-gold" aria-hidden />
            <b className="truncate font-semibold">{site.domain}</b>
            <span className="truncate text-[12px] text-faint">{site.name}</span>
          </span>
          <span className="text-[12px] text-dim">{siteMeta(site, usage)}</span>
          {usage === 'loading' && <span className="font-mono text-[11px] text-faint">reading Gully Analytics…</span>}
          {usage && usage !== 'loading' && !usage.ok && <span className="font-mono text-[11px] text-error">Gully Analytics figures unreadable: {usage.error}</span>}
          {site.blocked && <span className="font-mono text-[11px] text-error">{BLOCK_TEXT[site.blocked]}</span>}
        </span>
        <span className="w-[100px] shrink-0" title={`${Math.round(share * 100)}% of this month’s events`}>
          <Meter value={Math.round(share * 1000)} max={1000} label={`${site.domain}: share of this month’s events`} />
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <ExtLink href={site.dashboardUrl} className={pillSm}>
            Open
          </ExtLink>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={pillSm}>
            <Code2 size={14} aria-hidden /> {open ? 'Hide snippet' : 'Install'}
          </button>
          <Can cat="analytics" what="remove websites" hide>
            <button type="button" onClick={onDelete} aria-label={`Remove ${site.name}`} className="inline-flex size-11 items-center justify-center rounded-full border border-line-strong text-muted transition-colors hover:border-error hover:text-error">
              <Trash2 size={15} aria-hidden />
            </button>
          </Can>
        </span>
      </div>
      {open && (
        <div className="flex min-w-0 flex-col gap-2">
          <CodeBlock lang="html" code={snippet(origin, site.id)} caption="Paste before </head> on every page" />
          <span className="font-mono text-[11px] break-all text-faint">website id {site.id}</span>
        </div>
      )}
    </li>
  )
}

function Websites({ account, origin, reload }: { account: AnalyticsAccount; origin: string; reload: () => Promise<void> }) {
  const [usage, setUsage] = useState<AnalyticsUsage | 'loading' | { error: string }>('loading')
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [removing, setRemoving] = useState<AnalyticsSite | null>(null)
  const siteKey = account.sites.map((s) => s.id).join()

  useEffect(() => {
    let alive = true
    if (!siteKey) return
    api<AnalyticsUsage>('/api/developer/analytics/usage').then((r) => alive && setUsage(r.ok ? r.data : { error: r.error }))
    return () => {
      alive = false
    }
  }, [siteKey])

  const limit = account.plan?.sites ?? 0
  const canAdd = account.state !== 'lapsed' && account.sites.length < limit
  const totalEvents = account.sites.reduce((a, s) => a + s.eventsThisMonth, 0)

  const add = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const r = await api('/api/developer/analytics/sites', { method: 'POST', body: { name, domain } })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    toastSuccess('Website added', { detail: domain.trim() })
    setName('')
    setDomain('')
    await reload()
  }
  const remove = async () => {
    if (!removing) return
    setBusy(true)
    const r = await api(`/api/developer/analytics/sites/${removing.id}/delete`, { method: 'POST' })
    setBusy(false)
    if (!r.ok) return toastError(`Could not remove ${removing.domain}`, { detail: r.error })
    toastSuccess('Website removed', { detail: removing.domain })
    setRemoving(null)
    await reload()
  }
  const usageOf = (id: string): SiteUsage => (usage === 'loading' ? 'loading' : 'error' in usage ? ({ id, ok: false, error: usage.error } as const) : usage.sites.find((s) => s.id === id))

  return (
    <section className={`${panel} gap-2 p-3`} style={rise(1)} aria-labelledby="ga-sites">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-[2px]">
          <h2 id="ga-sites" className={panelTitle}>
            Websites
          </h2>
          <span className={mono}>
            {account.sites.length} of {account.plan ? limit : '—'} on your plan · events counted per UTC month
          </span>
        </div>
      </div>
      {!account.sites.length ? (
        <p className="m-0 flex items-center gap-2 text-[13px] text-muted">
          <Globe size={16} className="text-gold" aria-hidden /> No websites yet. Add your dapp&apos;s domain below to get its website id and the install snippet.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {account.sites.map((s) => (
            <SiteRow key={s.id} site={s} origin={origin} usage={usageOf(s.id)} share={totalEvents ? s.eventsThisMonth / totalEvents : 0} onDelete={() => setRemoving(s)} />
          ))}
        </ul>
      )}
      {canAdd ? (
        <form onSubmit={add} className="grid grid-cols-1 items-end gap-2 border-t border-line pt-2 min-[1024px]:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]">
          <label className="flex flex-col gap-2 text-[13px] text-ink-2">
            Name
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required placeholder="My dapp" />
          </label>
          <label className="flex flex-col gap-2 text-[13px] text-ink-2">
            Domain
            <input className={input} value={domain} onChange={(e) => setDomain(e.target.value)} maxLength={253} required placeholder="app.example.com" inputMode="url" autoCapitalize="off" spellCheck={false} />
          </label>
          <Can cat="analytics" what="add websites">
            <button type="submit" disabled={busy || !name.trim() || !domain.trim()} className={pillGold}>
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Plus size={16} aria-hidden />} Add website
            </button>
          </Can>
        </form>
      ) : (
        <p className="m-0 border-t border-line pt-3 text-[13px] text-faint">{account.state === 'lapsed' ? 'Choose a plan below to add websites again.' : `Your plan includes ${limit} website${limit === 1 ? '' : 's'}. Remove one or upgrade to add another.`}</p>
      )}
      {err && <ErrorLine>{err}</ErrorLine>}
      <Dialog open={!!removing} onClose={() => setRemoving(null)} title="Remove website">
        {removing ? (
          <div className="flex flex-col gap-4">
            <p className="m-0 text-[15px] leading-[1.6] text-muted">
              <b className="text-ink">{removing.name}</b> ({removing.domain}) is removed from Gully Analytics with the figures recorded for it, and its snippet stops recording. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRemoving(null)} className={pillLine}>
                Cancel
              </button>
              <button type="button" disabled={busy} onClick={remove} className={pillDanger}>
                {busy ? 'Removing…' : 'Remove website'}
              </button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </section>
  )
}

function PlanList({ view, account, onBuy }: { view: AnalyticsView; account: AnalyticsAccount; onBuy: (p: AnalyticsPlan) => void }) {
  const offer = view.offer
  const paid = offer.analytics.plans.filter((p) => p.priceUsdc > 0)
  return (
    <section className={`${panel} gap-2 p-3`} style={rise(2)} aria-labelledby="ga-plans">
      <div className="flex flex-col gap-[2px]">
        <h2 id="ga-plans" className={panelTitle}>
          Analytics plans
        </h2>
        <span className={`${mono} truncate`} title={`Paid on ${offer.chains.map((c) => c.name).join(', ')}`}>
          USD · paid on {offer.chains.length} chains · {offer.analytics.periodDays} days per payment · nothing renews by itself
        </span>
      </div>
      {!offer.checkout.enabled && (
        <p className="m-0 rounded-[10px] border border-line-strong bg-surface-deep px-4 py-3 text-[14px] text-ink-2" role="status">
          {offer.checkout.reason} The limits below are what each plan will include.
        </p>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-2">
        {paid.map((p) => {
          const isCur = account.state === 'active' && account.plan?.id === p.id
          return (
            <div key={p.id} className={`flex flex-col gap-2 rounded-[12px] border bg-surface-deep p-3 ${isCur ? 'border-gold-line' : 'border-line'}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-2 text-[15px] font-semibold">
                  {p.name}
                  {isCur && <span className="rounded-full border border-gold-line px-2 font-mono text-[11px] text-gold">CURRENT</span>}
                </span>
                <span className="font-display text-[24px] leading-none font-bold">
                  {p.priceUsdc} <span className="font-mono text-[11px] font-normal text-faint">USD / {offer.analytics.periodDays} days</span>
                </span>
              </div>
              <span className="font-mono text-[12px] text-muted">
                {p.sites} websites · {n(p.eventsPerMonth)} events a month · Web3 tracking
              </span>
              <Can cat="billing" what="pay for plans" block>
                <button type="button" disabled={!offer.checkout.enabled} onClick={() => onBuy(p)} className={`${isCur ? pillLine : pillGold} w-full`}>
                  {!offer.checkout.enabled ? 'Not on sale yet' : isCur ? `Extend ${p.name} by ${offer.analytics.periodDays} days` : `Choose ${p.name}`}
                </button>
              </Can>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Checkout({ plan, view, account, onPaid, onCancel }: { plan: AnalyticsPlan; view: AnalyticsView; account: AnalyticsAccount; onPaid: () => void; onCancel: () => void }) {
  const [done, setDone] = useState<Payment | null>(null)
  const switching = account.state === 'active' && account.plan?.id !== plan.id
  if (done)
    return (
      <section className={`${panel} border-success-line`} style={rise(0)}>
        <div className="flex items-start gap-3">
          <CheckCircle2 size={22} className="mt-[2px] shrink-0 text-green" aria-hidden />
          <div className="flex flex-col gap-1">
            <h2 className={panelTitle}>Payment confirmed</h2>
            <span className="text-[14px] text-muted">
              {done.amount} {done.symbol} received on {done.chain}. {plan.name} runs until {fmtDate(done.expiresAt)}; your websites record again now.
            </span>
            {done.txUrl && (
              <a href={done.txUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 font-mono text-[12px] text-ink-2 hover:text-gold">
                {shortAddress(done.txHash)} <ArrowUpRight size={12} aria-hidden />
              </a>
            )}
          </div>
        </div>
        <div>
          <button type="button" onClick={onCancel} className={pillLine}>
            Done
          </button>
        </div>
      </section>
    )
  return (
    <section className={`${panel} border-gold-line`} style={rise(0)} aria-labelledby="ga-pay">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-[2px]">
          <h2 id="ga-pay" className={panelTitle}>
            Gully Analytics {plan.name} · {view.offer.analytics.periodDays} days
          </h2>
          <span className={mono}>{plan.priceUsdc} USD · quotes last 20 minutes</span>
        </div>
        <button type="button" onClick={onCancel} className="inline-flex min-h-11 items-center rounded-full px-3 font-mono text-[12px] text-muted hover:text-ink">
          Back to plans
        </button>
      </div>
      {switching && account.plan && <p className="m-0 rounded-[10px] border border-gold-line bg-[rgba(217,181,99,.06)] px-4 py-3 text-[14px] text-ink-2">You are on {account.plan.name} until {fmtDate(account.expiresAt)}. A different plan starts today; the days left on {account.plan.name} are not carried over.</p>}
      <PayFlow
        offer={view.offer}
        usd={plan.priceUsdc}
        label={`Gully Analytics ${plan.name}, ${view.offer.analytics.periodDays} days`}
        getQuote={(asset) => api<{ intent: Quote }>('/api/developer/analytics/checkout', { method: 'POST', body: { plan: plan.id, asset } }).then((r) => (r.ok ? { ...r, data: { quote: r.data.intent } } : r))}
        verify={(q, txHash) => api('/api/developer/analytics/checkout/verify', { method: 'POST', body: { quoteId: q.id, txHash } })}
        onPaid={(data) => {
          setDone((data as { payment: Payment }).payment)
          onPaid()
        }}
      />
    </section>
  )
}

/** What the plan's state means, in one line, and this month's events against it. */
function PlanStatus({ account }: { account: AnalyticsAccount }) {
  const lapsed = account.state === 'lapsed'
  return (
    <section className={`${panel} flex-row flex-wrap items-center gap-3 p-3`} aria-label="Gully Analytics plan" data-testid="ga-status">
      <span className="min-w-0 flex-[1_1_320px] text-[13px] leading-[1.5] text-muted">
        {account.state === 'trial' && (
          <>
            Free trial until <b className="font-medium text-ink">{fmtDate(account.expiresAt)}</b>. Choose a plan any time to keep recording after it.
          </>
        )}
        {account.state === 'active' && (
          <>
            {account.plan?.name} runs until <b className="font-medium text-ink">{fmtDate(account.expiresAt)}</b> ({account.source === 'admin' ? 'granted by Gully Labs' : 'paid'}). It does not renew by itself: pay again to extend it.
          </>
        )}
        {lapsed && (
          <>
            {account.lastPlan ? `${account.lastPlan.name}` : 'The trial'} ended {fmtDate(account.lapsedAt)}: new events are not recorded. Your dashboard stays readable until <b className="font-medium text-ink">{fmtDate(account.readableUntil)}</b>; after that the account may be deleted.
          </>
        )}
      </span>
      <div className="min-w-[220px] flex-[1_1_280px]">
        <EventsMeter account={account} />
      </div>
    </section>
  )
}

/** Events used against the monthly quota: one ring for the whole account (a slice per site), one per site. */
function QuotaCard({ account }: { account: AnalyticsAccount }) {
  const quota = account.plan?.eventsPerMonth ?? null
  const colors = (i: number) => KEY_COLORS[i % KEY_COLORS.length]
  return (
    <section className={`${panel} gap-2 p-3`} style={rise(1)} aria-labelledby="ga-quota" data-testid="quota-rings">
      <div className="flex flex-col gap-[2px]">
        <h2 id="ga-quota" className={panelTitle}>
          Events against the quota
        </h2>
        <span className={mono}>{new Date(account.monthStart).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })} (UTC) · every site shares the plan&apos;s monthly events</span>
      </div>
      {quota === null ? (
        <p className="m-0 rounded-[10px] border border-dashed border-line-strong px-3 py-4 text-center font-mono text-[12px] text-faint">No running plan, so there is no quota to measure against: {n(account.eventsThisMonth)} events this month.</p>
      ) : (
        <div className="flex flex-wrap items-start justify-center gap-3 min-[700px]:justify-start">
          <QuotaRing caption="All sites" quota={quota} size={128} slices={account.sites.length ? account.sites.map((s, i) => ({ name: s.domain, value: s.eventsThisMonth, color: colors(i) })) : [{ name: 'events', value: account.eventsThisMonth, color: KEY_COLORS[0] }]} />
          {account.sites.map((s, i) => (
            <QuotaRing key={s.id} caption={s.domain} quota={quota} size={96} slices={[{ name: s.domain, value: s.eventsThisMonth, color: colors(i) }]} />
          ))}
        </div>
      )}
    </section>
  )
}

function Payments({ payments }: { payments: Payment[] }) {

  return (
    <section className={`${panel} gap-2 p-3`} style={rise(3)} aria-labelledby="ga-payments">
      <div className="flex flex-col gap-[2px]">
        <h2 id="ga-payments" className={panelTitle}>
          Analytics payments
        </h2>
        <span className={mono}>Every payment this wallet has made for Gully Analytics</span>
      </div>
      {!payments.length ? (
        <p className="m-0 flex items-center gap-2 text-[13px] text-muted">
          <Receipt size={16} className="text-gold" aria-hidden /> No payments yet. Payments for a Gully Analytics plan appear here with their transaction.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0 font-mono text-[13px]">
          {payments.map((p) => (
            <li key={`${p.chainId}:${p.txHash}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-[10px] border border-line px-3 py-2">
              <span className="text-muted">{fmtDate(p.at)}</span>
              <span className="text-ink uppercase">{p.plan}</span>
              <span className="inline-flex items-center gap-[6px] text-ink-2">
                <ChainLogo chain={p.chain} size={14} decorative /> {p.amount} {p.symbol} · {p.chain}
              </span>
              <span className="text-muted">
                {fmtDate(p.periodStart)} – {fmtDate(p.expiresAt)}
              </span>
              {p.txUrl ? (
                <a href={p.txUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-ink-2 hover:text-gold">
                  {shortAddress(p.txHash)} <ArrowUpRight size={12} aria-hidden />
                </a>
              ) : (
                <span className="text-ink-2">{shortAddress(p.txHash)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

type AnalyticsSub = 'traffic' | 'sites' | 'plan' | 'payments'
const ANALYTICS_SUBS: readonly AnalyticsSub[] = ['traffic', 'sites', 'plan', 'payments']

/** Setup as a stepper: Start the trial → Add a website → Install the snippet → First event. The server sees
    the snippet only through the events it sends, so "installed" ticks when a website has recorded. */
function AnalyticsSetup({ view, account, onStarted, goSites }: { view: AnalyticsView; account: AnalyticsAccount | null; onStarted: (s: Secret) => void; goSites: () => void }) {
  const site = account?.sites[0] ?? null
  const recorded = !!account && account.sites.some((s) => s.eventsThisMonth > 0)
  const steps = [
    { id: 'start', label: view.trialAvailable ? 'Start the trial' : 'Create a login', done: !!account },
    { id: 'site', label: 'Add a website', done: !!account?.sites.length },
    { id: 'install', label: 'Install the snippet', done: recorded },
    { id: 'event', label: 'First event', done: !!account && account.eventsThisMonth > 0 },
  ]
  return (
    <Stepper title="Set up Gully Analytics" steps={steps} testId="analytics-stepper">
      {(id) =>
        id === 'start' ? (
          <StartStep view={view} onStarted={onStarted} />
        ) : id === 'site' ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-[1_1_260px] text-[13px] text-muted">Add your dapp&apos;s domain to get its website id and the one-line install snippet.</span>
            <button type="button" onClick={goSites} className={pillGold}>
              <Plus size={16} aria-hidden /> Add a website
            </button>
          </div>
        ) : id === 'install' ? (
          site ? (
            <div className="flex min-w-0 flex-col gap-2">
              <span className="text-[13px] text-muted">
                Paste this before &lt;/head&gt; on every page of <b className="font-semibold text-ink">{site.domain}</b>. It ticks here once the site records its first event.
              </span>
              <CodeBlock lang="html" code={snippet(view.dashboardOrigin, site.id)} caption="Install snippet" />
            </div>
          ) : (
            <span className="text-[13px] text-muted">Add a website first.</span>
          )
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex min-w-0 flex-[1_1_260px] items-center gap-2 text-[13px] text-muted">
              <span className="relative grid size-2 place-items-center" aria-hidden>
                <span className="absolute size-2 rounded-full bg-gold/50" style={{ animation: 'gl-live-pulse 2.4s ease-out infinite' }} />
                <span className="size-[6px] rounded-full bg-gold" />
              </span>
              Waiting for the first event: open your site once and it lands within a minute.
            </span>
            {account && <OpenAnalytics loginUrl={account.loginUrl} className={pillLine} />}
          </div>
        )
      }
    </Stepper>
  )
}

function AnalyticsKpis({ account }: { account: AnalyticsAccount }) {
  const left = daysLeft(account.expiresAt)
  const lapsed = account.state === 'lapsed'
  return (
    <KpiRow label="Gully Analytics at a glance">
      <KpiTile i={0} label="Plan" icon={<ChartNoAxesCombined size={13} aria-hidden />} note={lapsed ? `ended ${fmtDate(account.lapsedAt)}` : account.state === 'trial' ? 'free trial' : account.source === 'admin' ? 'granted by Gully Labs' : 'paid'}>
        <span className={`text-[20px] uppercase ${lapsed ? 'text-error' : account.state === 'active' ? 'text-gold' : ''}`}>{lapsed ? 'Ended' : (account.plan?.name ?? '—')}</span>
      </KpiTile>
      <KpiTile i={1} label="Events this month" icon={<Code2 size={13} aria-hidden />} note={account.plan ? `of ${n(account.plan.eventsPerMonth)}` : 'no running plan'}>
        <AnimatedNumber value={account.eventsThisMonth} countUp />
      </KpiTile>
      <KpiTile i={2} label="Websites" icon={<Globe size={13} aria-hidden />} note={account.plan ? `of ${account.plan.sites} on the plan` : 'no running plan'}>
        <AnimatedNumber value={account.sites.length} countUp />
      </KpiTile>
      <KpiTile i={3} label="Days left" icon={<Receipt size={13} aria-hidden />} note={lapsed ? `readable until ${fmtDate(account.readableUntil)}` : `until ${fmtDate(account.expiresAt)}`}>
        {lapsed || left === null ? <Unknown why={lapsed ? 'The plan has ended' : 'No end date on this plan'} /> : <AnimatedNumber value={left} countUp />}
      </KpiTile>
    </KpiRow>
  )
}

export function AnalyticsPanel() {
  const poll = usePoll<AnalyticsView>('/api/developer/analytics', 60_000)
  const view = poll.data
  const load = poll.reload
  const [secret, setSecret] = useState<Secret>(null)
  const [buying, setBuying] = useState<AnalyticsPlan | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetErr, setResetErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sub, setSub] = useSubTab<AnalyticsSub>('analytics', ANALYTICS_SUBS, 'traffic')

  const reset = async () => {
    setBusy(true)
    setResetErr(null)
    const r = await api<{ username: string; password: string }>('/api/developer/analytics/password', { method: 'POST' })
    setBusy(false)
    if (!r.ok) return setResetErr(r.error)
    toastSuccess('Password reset', { detail: 'The old password stopped working.' })
    setConfirmReset(false)
    setSecret({ username: r.data.username, password: r.data.password, first: false })
  }

  // Only a tab that has never loaded shows an error in place of its content.
  if (!view && (poll.error || poll.timedOut)) return <ErrorLine onRetry={load}>Gully Analytics could not be read: {poll.error ?? 'no answer in time'}</ErrorLine>
  if (!view)
    return (
      <div className="flex flex-col gap-2">
        <Skeleton h={120} />
        <Skeleton h={200} />
      </div>
    )

  const a = view.account
  const loginUrl = a?.loginUrl ?? `${view.dashboardOrigin}/login`
  const started = (s: Secret) => {
    setSecret(s)
    load()
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <InfoTip className="flex-[1_1_240px]" summary="Page views plus wallet connects, chains and transactions, on a dashboard of your own">
          Cookie-free, one script tag with data-web3. Starting creates a Gully Analytics login for this wallet; you add websites here and read them there. Every tracker call counts against the plan&apos;s monthly events: page views, custom events and Web3 events. At the limit the server stops recording until the month turns or you upgrade. Plans are separate from the API plans.{' '}
          <ExtLink href={`${DOCS_URL}/analytics`} className="text-gold underline-offset-4 hover:underline">
            How it works
          </ExtLink>
        </InfoTip>
        <RefreshChip error={poll.stale ? poll.error : null} onRetry={load} />
        {a && (
          <>
            <span className="flex items-center gap-1 font-mono text-[12px] text-muted">
              <KeyRound size={14} className="text-gold" aria-hidden /> <code className="text-ink">{a.username}</code>
              <CopyButton text={a.username} what="Username" label="Copy" className="!min-h-8 border-none !px-2 text-[11px]" />
            </span>
            <Can cat="analytics" what="reset the Gully Analytics password" hide>
              <button type="button" onClick={() => setConfirmReset(true)} className={rowPill}>
                <RotateCw size={13} aria-hidden /> Reset password
              </button>
            </Can>
            <OpenAnalytics loginUrl={a.loginUrl} />
          </>
        )}
      </div>

      <AnalyticsSetup view={view} account={a} onStarted={started} goSites={() => setSub('sites')} />

      {a && (
        <>
          <AnalyticsKpis account={a} />
          <SubTabs
            label="Gully Analytics sections"
            idBase="ga-sub"
            value={sub}
            onChange={setSub}
            items={[
              { id: 'traffic', label: 'Traffic', icon: <ChartNoAxesCombined size={15} aria-hidden /> },
              { id: 'sites', label: 'Websites', icon: <Globe size={15} aria-hidden />, count: a.sites.length },
              { id: 'plan', label: 'Plan', icon: <CreditCard size={15} aria-hidden />, dot: a.state === 'lapsed' },
              { id: 'payments', label: 'Payments', icon: <Receipt size={15} aria-hidden />, count: view.payments.length },
            ]}
          />
          <SubPanel idBase="ga-sub" value={sub}>
            {sub === 'traffic' && <AnalyticsTraffic account={a} />}
            {sub === 'sites' && <Websites account={a} origin={view.dashboardOrigin} reload={load} />}
            {sub === 'plan' &&
              (buying ? (
                <Checkout
                  key={buying.id}
                  plan={buying}
                  view={view}
                  account={a}
                  onPaid={load}
                  onCancel={() => {
                    setBuying(null)
                    load()
                  }}
                />
              ) : (
                <>
                  <PlanStatus account={a} />
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-[1_1_320px]">
                      <QuotaCard account={a} />
                    </div>
                    <div className="min-w-0 flex-[2_1_480px]">
                      <PlanList view={view} account={a} onBuy={setBuying} />
                    </div>
                  </div>
                </>
              ))}
            {sub === 'payments' && <Payments payments={view.payments} />}
          </SubPanel>
        </>
      )}
      <PasswordDialog secret={secret} loginUrl={loginUrl} onClose={() => setSecret(null)} />
      <Dialog open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset password">
        <div className="flex flex-col gap-4">
          <p className="m-0 text-[15px] leading-[1.6] text-muted">A new password is set on your Gully Analytics login and shown once. The old one stops working and open sessions are signed out.</p>
          {resetErr && <ErrorLine>{resetErr}</ErrorLine>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmReset(false)} className={pillLine}>
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={reset} className={pillGold}>
              {busy ? 'Setting…' : 'Set a new password'}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
