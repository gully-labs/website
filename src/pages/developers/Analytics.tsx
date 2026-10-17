import { AlertTriangle, ArrowUpRight, ChartNoAxesCombined, Check, CheckCircle2, Code2, Globe, KeyRound, Loader2, Plus, Receipt, ShieldCheck, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { QuotePay } from '../../components/pay/QuotePay'
import { btnGold, btnOutline } from '../../components/ui'
import { CodeBlock } from '../../docs/CodeBlock'
import { DOCS_URL } from '../../site-host'
import { api, fmtDate, shortAddress, type AnalyticsAccount, type AnalyticsBlock, type AnalyticsPlan, type AnalyticsSite, type AnalyticsUsage, type AnalyticsView, type Payment, type Quote } from './api'
import { CopyButton, Dialog } from './Dialog'
import { Empty, ErrorLine, Skeleton } from './parts'
import { card, cardTitle, input, rise, sub } from './styles'

/* Gully Analytics, self-serve: start a free trial (the server creates a Gully Analytics login for this
   wallet and shows its password once), add websites, copy the install snippet, watch this month's
   events against the plan, and buy or extend a plan with Gully Pay. Every plan figure comes from the
   server (GET /api/developer/analytics, which reads server/plans.mjs); nothing is priced here. */

const n = (v: number) => v.toLocaleString('en-US')

const BLOCK_TEXT: Record<AnalyticsBlock, string> = {
  'gully-plan-lapsed': 'Not recording: no running plan',
  'gully-site-limit': 'Not recording: beyond your plan’s websites',
  'gully-quota-exceeded': 'Not recording: monthly events used',
}

const snippet = (origin: string, id: string) => `<script defer src="${origin}/script.js"\n  data-website-id="${id}"\n  data-web3="true"></script>`

type Secret = { username: string; password: string; first: boolean } | null

function PasswordDialog({ secret, loginUrl, onClose }: { secret: Secret; loginUrl: string; onClose: () => void }) {
  return (
    <Dialog open={!!secret} onClose={onClose} title={secret?.first ? 'Your Gully Analytics login' : 'Your new password'} dismissable={false}>
      {secret ? (
        <div className="flex flex-col gap-4">
          <p className="m-0 flex items-start gap-3 rounded-input border border-gold-line bg-[rgba(232,192,96,.06)] px-4 py-3 text-[14px] leading-[1.55] text-ink-2">
            <AlertTriangle size={18} className="mt-[2px] shrink-0 text-gold" aria-hidden />
            Copy the password now. It is shown this once and we do not keep it. Lost it? Reset it from this tab.
          </p>
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11px] tracking-[1px] text-faint">USERNAME</span>
            <div className="flex items-center gap-2 rounded-input border border-line bg-bg py-1 pr-1 pl-3">
              <code className="min-w-0 flex-1 font-mono text-[13px] break-all text-ink">{secret.username}</code>
              <CopyButton text={secret.username} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11px] tracking-[1px] text-faint">PASSWORD</span>
            <div className="flex items-center gap-2 rounded-input border border-gold-line bg-bg py-1 pr-1 pl-3">
              <code className="min-w-0 flex-1 font-mono text-[13px] break-all text-gold" data-testid="analytics-password">
                {secret.password}
              </code>
              <CopyButton text={secret.password} />
            </div>
          </div>
          <a href={loginUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-mono text-[12px] text-muted hover:text-gold">
            Sign in at {loginUrl.replace(/^https:\/\//, '')} <ArrowUpRight size={12} aria-hidden />
          </a>
          <div className="flex justify-end">
            <button type="button" data-autofocus onClick={onClose} className={`${btnGold} inline-flex min-h-11 items-center gap-2 px-5 text-[15px]`}>
              <Check size={16} aria-hidden /> I have saved it
            </button>
          </div>
        </div>
      ) : null}
    </Dialog>
  )
}

function Meter({ used, limit }: { used: number; limit: number }) {
  const pct = Math.min(100, (used / Math.max(1, limit)) * 100)
  const tone = pct >= 100 ? 'bg-error' : pct >= 80 ? 'bg-gold' : 'bg-green'
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-display text-[34px] leading-none font-extrabold">
          {n(used)} <span className="font-mono text-[12px] font-normal text-faint">/ {n(limit)} events</span>
        </span>
        <span className="font-mono text-[12px] text-muted">{pct >= 100 ? 'limit reached' : `${Math.round(pct)}%`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-deep" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label="Events this month">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function StartCard({ view, onStarted }: { view: AnalyticsView; onStarted: (s: Secret) => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const trial = view.offer.analytics.plans.find((p) => p.id === 'trial')
  const start = async () => {
    setBusy(true)
    setErr(null)
    const r = await api<{ account: AnalyticsAccount; password: string }>('/api/developer/analytics/start', { method: 'POST' })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    onStarted({ username: r.data.account.username, password: r.data.password, first: true })
  }
  return (
    <section className={`${card} relative overflow-hidden`} style={rise(0)}>
      <div aria-hidden className="pointer-events-none absolute -top-32 right-[-12%] size-[420px] rounded-full bg-[radial-gradient(circle,rgba(232,192,96,.12),transparent_62%)]" />
      <div className="relative flex flex-col gap-3">
        <span className={sub}>GULLY ANALYTICS</span>
        <h2 className="m-0 font-display text-[clamp(30px,3.4cqw,44px)] leading-[.95] font-extrabold uppercase">
          Analytics that <span className="text-gold">see the wallet</span>
        </h2>
        <p className="m-0 max-w-[640px] text-[15px] leading-[1.6] text-muted">Page views plus wallet connects, chains and transactions for your dapp, on a dashboard of your own. Starting creates a Gully Analytics login for this wallet; you add websites here and read them there.</p>
      </div>
      {view.trialAvailable && trial ? (
        <ul className="relative m-0 grid list-none grid-cols-3 gap-px overflow-hidden rounded-input border border-line bg-line p-0 max-[600px]:grid-cols-1">
          {[
            [`${view.offer.analytics.trialDays} days`, 'free, no payment'],
            [`${trial.sites} website${trial.sites === 1 ? '' : 's'}`, 'with Web3 tracking'],
            [`${n(trial.eventsPerMonth)}`, 'events a month'],
          ].map(([v, l]) => (
            <li key={l} className="flex flex-col gap-1 bg-surface-deep px-5 py-4">
              <span className="font-display text-[26px] leading-none font-bold text-ink">{v}</span>
              <span className="font-mono text-[11px] text-faint">{l}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="relative m-0 rounded-input border border-line-strong bg-surface-deep px-4 py-3 text-[14px] text-ink-2">This wallet has had its free trial. You can create a login again and choose a plan to start recording.</p>
      )}
      {!view.configured && (
        <p className="relative m-0 rounded-input border border-line-strong bg-surface-deep px-4 py-3 text-[14px] text-ink-2" role="status">
          Self-serve sign-up is not switched on on this server yet. Write to hello@gullylabs.xyz for early access.
        </p>
      )}
      {err && <ErrorLine>{err}</ErrorLine>}
      <div className="relative flex flex-wrap items-center gap-3">
        <button type="button" onClick={start} disabled={busy || !view.configured} className={`${btnGold} inline-flex min-h-12 items-center gap-2 px-6 text-[16px] disabled:cursor-not-allowed disabled:opacity-50`}>
          {busy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <ChartNoAxesCombined size={17} aria-hidden />}
          {busy ? 'Creating your login…' : view.trialAvailable ? 'Start free trial' : 'Create my login'}
        </button>
        <a href={`${DOCS_URL}/analytics`} className={`${btnOutline} inline-flex min-h-12 items-center gap-2 px-5 text-[15px]`}>
          How it works <ArrowUpRight size={15} aria-hidden />
        </a>
      </div>
    </section>
  )
}

function SiteRow({ site, origin, usage, onDelete }: { site: AnalyticsSite; origin: string; usage: AnalyticsUsage['sites'][number] | undefined | 'loading'; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="flex flex-col gap-3 rounded-input border border-line bg-surface-deep p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <Globe size={15} className="shrink-0 text-gold" aria-hidden />
            <span className="text-[16px] font-medium text-ink">{site.name}</span>
            <span className="font-mono text-[12px] text-muted">{site.domain}</span>
          </span>
          <span className="font-mono text-[11px] break-all text-faint">{site.id}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={site.dashboardUrl} target="_blank" rel="noopener" className="inline-flex min-h-10 items-center gap-1 rounded-btn border border-line-strong px-3 text-[13px] text-ink-2 transition-colors hover:border-gold hover:text-ink">
            Dashboard <ArrowUpRight size={13} aria-hidden />
          </a>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex min-h-10 items-center gap-1 rounded-btn border border-line-strong px-3 text-[13px] text-ink-2 transition-colors hover:border-gold hover:text-ink">
            <Code2 size={14} aria-hidden /> {open ? 'Hide snippet' : 'Install'}
          </button>
          <button type="button" onClick={onDelete} aria-label={`Remove ${site.name}`} className="inline-flex size-10 items-center justify-center rounded-btn border border-line-strong text-muted transition-colors hover:border-error hover:text-error">
            <Trash2 size={15} aria-hidden />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-[12px] text-muted">
        <span>
          <b className="font-medium text-ink">{n(site.eventsThisMonth)}</b> events counted this month
        </span>
        {usage === 'loading' ? (
          <span className="text-faint">reading Gully Analytics…</span>
        ) : usage?.ok ? (
          <span>
            Gully Analytics: <b className="font-medium text-ink">{usage.stats.pageviews === null ? '—' : n(usage.stats.pageviews)}</b> page views · <b className="font-medium text-ink">{usage.stats.customEvents === null ? '—' : n(usage.stats.customEvents)}</b> custom events · <b className="font-medium text-ink">{usage.stats.visitors === null ? '—' : n(usage.stats.visitors)}</b> visitors
          </span>
        ) : usage ? (
          <span className="text-error">Gully Analytics figures unreadable: {usage.error}</span>
        ) : null}
        {site.blocked && <span className="text-error">{BLOCK_TEXT[site.blocked]}</span>}
      </div>
      {open && <CodeBlock lang="html" code={snippet(origin, site.id)} caption="Paste before </head> on every page" />}
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

  const add = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const r = await api('/api/developer/analytics/sites', { method: 'POST', body: { name, domain } })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    setName('')
    setDomain('')
    await reload()
  }
  const remove = async () => {
    if (!removing) return
    setBusy(true)
    const r = await api(`/api/developer/analytics/sites/${removing.id}/delete`, { method: 'POST' })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    setRemoving(null)
    await reload()
  }
  const usageOf = (id: string) => (usage === 'loading' ? 'loading' : 'error' in usage ? ({ id, ok: false, error: usage.error } as const) : usage.sites.find((s) => s.id === id))

  return (
    <section className={card} style={rise(2)}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-[6px]">
          <h2 className={cardTitle}>Websites</h2>
          <span className={sub}>
            {account.sites.length} of {account.plan ? limit : '—'} on your plan · events counted per UTC month
          </span>
        </div>
      </div>
      {!account.sites.length ? (
        <Empty icon={<Globe size={26} className="text-gold" aria-hidden />} title="No websites yet">
          Add your dapp’s domain to get its website id and the one-line install snippet.
        </Empty>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {account.sites.map((s) => (
            <SiteRow key={s.id} site={s} origin={origin} usage={usageOf(s.id)} onDelete={() => setRemoving(s)} />
          ))}
        </ul>
      )}
      {canAdd ? (
        <form onSubmit={add} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] items-end gap-3 border-t border-line pt-4 max-[760px]:grid-cols-1">
          <label className="flex flex-col gap-2 text-[13px] text-ink-2">
            Name
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required placeholder="My dapp" />
          </label>
          <label className="flex flex-col gap-2 text-[13px] text-ink-2">
            Domain
            <input className={input} value={domain} onChange={(e) => setDomain(e.target.value)} maxLength={253} required placeholder="app.example.com" inputMode="url" autoCapitalize="off" spellCheck={false} />
          </label>
          <button type="submit" disabled={busy || !name.trim() || !domain.trim()} className={`${btnGold} inline-flex min-h-11 items-center justify-center gap-2 px-5 text-[15px] disabled:opacity-50`}>
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Plus size={16} aria-hidden />} Add website
          </button>
        </form>
      ) : (
        <p className="m-0 border-t border-line pt-4 text-[13px] text-faint">{account.state === 'lapsed' ? 'Choose a plan below to add websites again.' : `Your plan includes ${limit} website${limit === 1 ? '' : 's'}. Remove one or upgrade to add another.`}</p>
      )}
      {err && <ErrorLine>{err}</ErrorLine>}
      <Dialog open={!!removing} onClose={() => setRemoving(null)} title="Remove website">
        {removing ? (
          <div className="flex flex-col gap-4">
            <p className="m-0 text-[15px] leading-[1.6] text-muted">
              <b className="text-ink">{removing.name}</b> ({removing.domain}) is removed from Gully Analytics with the figures recorded for it, and its snippet stops recording. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRemoving(null)} className={`${btnOutline} min-h-11 px-5 text-[15px]`}>
                Cancel
              </button>
              <button type="button" disabled={busy} onClick={remove} className="min-h-11 rounded-btn bg-error px-5 text-[15px] font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50">
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
    <section className={card} style={rise(3)}>
      <div className="flex flex-col gap-[6px]">
        <h2 className={cardTitle}>Plans</h2>
        <span className={sub}>
          Priced in USD · paid in ETH, BNB, USDC or USDT on {offer.chains.map((c) => c.name).join(', ')} · {offer.analytics.periodDays} days per payment · nothing renews by itself
        </span>
      </div>
      {!offer.checkout.enabled && (
        <p className="m-0 rounded-input border border-line-strong bg-surface-deep px-4 py-3 text-[14px] text-ink-2" role="status">
          {offer.checkout.reason} The limits below are what each plan will include.
        </p>
      )}
      <div className="grid grid-cols-2 gap-4 max-[760px]:grid-cols-1">
        {paid.map((p) => {
          const isCur = account.state === 'active' && account.plan?.id === p.id
          return (
            <div key={p.id} className={`flex flex-col gap-4 rounded-card border bg-surface-deep p-5 ${isCur ? 'border-gold-line' : 'border-line'}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-display text-[26px] leading-none font-bold uppercase">{p.name}</span>
                <span className="font-display text-[30px] leading-none font-extrabold text-gold">
                  {p.priceUsdc} <span className="font-mono text-[12px] font-normal text-faint">USD / {offer.analytics.periodDays} days</span>
                </span>
              </div>
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px] text-muted">
                <li>
                  <b className="font-medium text-ink">{p.sites}</b> websites
                </li>
                <li>
                  <b className="font-medium text-ink">{n(p.eventsPerMonth)}</b> events a month
                </li>
                <li>Web3 tracking, dashboard and Web3 tab</li>
              </ul>
              <button type="button" disabled={!offer.checkout.enabled} onClick={() => onBuy(p)} className={`${isCur ? btnOutline : btnGold} inline-flex min-h-11 items-center justify-center gap-2 px-5 text-[15px] disabled:cursor-not-allowed disabled:opacity-50`}>
                {!offer.checkout.enabled ? 'Not on sale yet' : isCur ? `Extend ${p.name} by ${offer.analytics.periodDays} days` : `Choose ${p.name}`}
              </button>
            </div>
          )
        })}
      </div>
      <p className="m-0 flex items-start gap-2 border-t border-line pt-4 text-[13px] leading-[1.6] text-faint">
        <ShieldCheck size={15} className="mt-[2px] shrink-0 text-gold" aria-hidden />
        You send the coin or stablecoin straight to the Gully Labs treasury wallet; we never hold your funds or a card. The server checks the transfer on its chain before the plan starts. This is separate from the tracker API plans.
      </p>
    </section>
  )
}

function Checkout({ plan, view, account, onPaid, onCancel }: { plan: AnalyticsPlan; view: AnalyticsView; account: AnalyticsAccount; onPaid: () => void; onCancel: () => void }) {
  const [done, setDone] = useState<Payment | null>(null)
  const switching = account.state === 'active' && account.plan?.id !== plan.id
  if (done)
    return (
      <section className={`${card} border-success-line`} style={rise(0)}>
        <div className="flex items-start gap-3">
          <CheckCircle2 size={22} className="mt-[2px] shrink-0 text-green" aria-hidden />
          <div className="flex flex-col gap-1">
            <h2 className={cardTitle}>Payment confirmed</h2>
            <span className="text-[15px] text-muted">
              {done.amount} {done.symbol} received on {done.chain}. {plan.name} runs until {fmtDate(done.expiresAt)}; your websites record again now.
            </span>
            {done.txUrl && (
              <a href={done.txUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-mono text-[12px] text-ink-2 hover:text-gold">
                {shortAddress(done.txHash)} <ArrowUpRight size={12} aria-hidden />
              </a>
            )}
          </div>
        </div>
        <div>
          <button type="button" onClick={onCancel} className={`${btnOutline} min-h-11 px-5 text-[15px]`}>
            Done
          </button>
        </div>
      </section>
    )
  return (
    <section className={`${card} border-gold-line`} style={rise(0)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-[6px]">
          <h2 className={cardTitle}>Pay for {plan.name}</h2>
          <span className={sub}>
            Gully Analytics · {plan.priceUsdc} USD for {view.offer.analytics.periodDays} days · quotes last 20 minutes
          </span>
        </div>
        <button type="button" onClick={onCancel} className="min-h-10 font-mono text-[12px] text-muted underline-offset-4 hover:text-ink hover:underline">
          Back to plans
        </button>
      </div>
      {switching && account.plan && <p className="m-0 rounded-input border border-gold-line bg-[rgba(232,192,96,.06)] px-4 py-3 text-[14px] text-ink-2">You are on {account.plan.name} until {fmtDate(account.expiresAt)}. A different plan starts today; the days left on {account.plan.name} are not carried over.</p>}
      <QuotePay
        assets={view.offer.assets}
        label={`Gully Analytics ${plan.name}, ${view.offer.analytics.periodDays} days`}
        match="wallet"
        initialAsset="base-usdc"
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

function StatusCard({ account, onReset }: { account: AnalyticsAccount; onReset: () => void }) {
  const lapsed = account.state === 'lapsed'
  return (
    <section className={card} style={rise(0)}>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-6 max-[900px]:grid-cols-1">
        <div className="flex flex-col gap-[6px]">
          <span className={sub}>GULLY ANALYTICS PLAN</span>
          <h2 className="m-0 font-display text-[40px] leading-none font-extrabold uppercase">
            <span className={lapsed ? 'text-error' : account.state === 'active' ? 'text-gold' : 'text-ink'}>{lapsed ? 'Ended' : account.plan?.name}</span>
          </h2>
          <span className="text-[14px] text-muted">
            {account.state === 'trial' && (
              <>
                Free trial until <b className="font-medium text-ink">{fmtDate(account.expiresAt)}</b>. Choose a plan any time to keep recording after it.
              </>
            )}
            {account.state === 'active' && (
              <>
                Runs until <b className="font-medium text-ink">{fmtDate(account.expiresAt)}</b> ({account.source === 'admin' ? 'granted by Gully Labs' : 'paid'}). It does not renew by itself: pay again to extend it.
              </>
            )}
            {lapsed && (
              <>
                {account.lastPlan ? `${account.lastPlan.name}` : 'The trial'} ended {fmtDate(account.lapsedAt)}: new events are not recorded. Your dashboard stays readable until <b className="font-medium text-ink">{fmtDate(account.readableUntil)}</b>; after that the account may be deleted.
              </>
            )}
          </span>
        </div>
        {account.plan ? (
          <div className="flex flex-col gap-3">
            <span className={sub}>EVENTS IN {new Date(account.monthStart).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).toUpperCase()} (UTC)</span>
            <Meter used={account.eventsThisMonth} limit={account.plan.eventsPerMonth} />
            <span className="text-[12px] leading-[1.5] text-faint">Every tracker call counts: page views, custom events and Web3 events. At the limit the server stops recording until the month turns or you upgrade.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <span className={sub}>EVENTS THIS MONTH</span>
            <span className="font-display text-[34px] leading-none font-extrabold">{n(account.eventsThisMonth)}</span>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-muted">
          <KeyRound size={15} className="text-gold" aria-hidden /> Login <code className="font-mono text-[13px] text-ink">{account.username}</code>
          <CopyButton text={account.username} label="Copy" className="!min-h-8 border-none !px-2 text-[11px]" />
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onReset} className="inline-flex min-h-10 items-center gap-2 rounded-btn border border-line-strong px-3 text-[13px] text-ink-2 transition-colors hover:border-gold hover:text-ink">
            Reset password
          </button>
          <a href={account.loginUrl} target="_blank" rel="noopener" className={`${btnGold} inline-flex min-h-10 items-center gap-1 px-4 text-[14px]`}>
            Open Gully Analytics <ArrowUpRight size={14} aria-hidden />
          </a>
        </span>
      </div>
    </section>
  )
}

function Payments({ payments }: { payments: Payment[] }) {
  return (
    <section className={card} style={rise(4)}>
      <div className="flex flex-col gap-[6px]">
        <h2 className={cardTitle}>Payments</h2>
        <span className={sub}>Every payment this wallet has made for Gully Analytics</span>
      </div>
      {!payments.length ? (
        <Empty icon={<Receipt size={26} className="text-gold" aria-hidden />} title="No payments yet">
          Payments for a Gully Analytics plan appear here with their transaction on the chain’s explorer.
        </Empty>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0 font-mono text-[13px]">
          {payments.map((p) => (
            <li key={`${p.chainId}:${p.txHash}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-input border border-line px-3 py-2">
              <span className="text-muted">{fmtDate(p.at)}</span>
              <span className="text-ink uppercase">{p.plan}</span>
              <span className="text-ink-2">
                {p.amount} {p.symbol} · {p.chain}
              </span>
              <span className="text-muted">
                {fmtDate(p.periodStart)} – {fmtDate(p.expiresAt)}
              </span>
              {p.txUrl ? (
                <a href={p.txUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-ink-2 hover:text-gold">
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

export function AnalyticsPanel() {
  const [view, setView] = useState<AnalyticsView | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [secret, setSecret] = useState<Secret>(null)
  const [buying, setBuying] = useState<AnalyticsPlan | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetErr, setResetErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    () =>
      api<AnalyticsView>('/api/developer/analytics').then((r) => {
        if (r.ok) {
          setView(r.data)
          setErr(null)
        } else setErr(r.error)
      }),
    [],
  )
  useEffect(() => {
    load()
  }, [load])

  const reset = async () => {
    setBusy(true)
    setResetErr(null)
    const r = await api<{ username: string; password: string }>('/api/developer/analytics/password', { method: 'POST' })
    setBusy(false)
    if (!r.ok) return setResetErr(r.error)
    setConfirmReset(false)
    setSecret({ username: r.data.username, password: r.data.password, first: false })
  }

  if (err) return <ErrorLine onRetry={load}>Gully Analytics could not be read: {err}</ErrorLine>
  if (!view)
    return (
      <div className="flex flex-col gap-3">
        <Skeleton h={160} />
        <Skeleton h={220} />
      </div>
    )

  const a = view.account
  const loginUrl = a?.loginUrl ?? `${view.dashboardOrigin}/login`
  return (
    <div className="flex flex-col gap-5">
      {!a ? (
        <StartCard
          view={view}
          onStarted={(s) => {
            setSecret(s)
            load()
          }}
        />
      ) : (
        <>
          <StatusCard account={a} onReset={() => setConfirmReset(true)} />
          {buying ? (
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
              <Websites account={a} origin={view.dashboardOrigin} reload={load} />
              <PlanList view={view} account={a} onBuy={setBuying} />
            </>
          )}
          <Payments payments={view.payments} />
        </>
      )}
      <PasswordDialog secret={secret} loginUrl={loginUrl} onClose={() => setSecret(null)} />
      <Dialog open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset password">
        <div className="flex flex-col gap-4">
          <p className="m-0 text-[15px] leading-[1.6] text-muted">A new password is set on your Gully Analytics login and shown once. The old one stops working and open sessions are signed out.</p>
          {resetErr && <ErrorLine>{resetErr}</ErrorLine>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmReset(false)} className={`${btnOutline} min-h-11 px-5 text-[15px]`}>
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={reset} className={`${btnGold} min-h-11 px-5 text-[15px] disabled:opacity-50`}>
              {busy ? 'Setting…' : 'Set a new password'}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
