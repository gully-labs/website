import { AlertTriangle, ArrowUpRight, ChartNoAxesCombined, Check, CheckCircle2, Code2, Globe, KeyRound, Loader2, Plus, Receipt, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CodeBlock } from '../../docs/CodeBlock'
import { DOCS_URL } from '../../site-host'
import { api, daysLeft, fmtDate, shortAddress, type AnalyticsAccount, type AnalyticsPlan, type AnalyticsSite, type AnalyticsUsage, type AnalyticsView, type Payment, type Quote } from './api'
import { Meter } from './charts'
import { BLOCK_TEXT, siteMeta, type SiteUsage } from './helpers'
import { CopyButton, Dialog } from './Dialog'
import { Empty, ErrorLine, Skeleton } from './parts'
import { PayFlow } from './PayFlow'
import { input, mono, panel, panelTitle, pillDanger, pillGold, pillLine, pillSm, rise } from './styles'

/* Gully Analytics, self-serve: start a free trial (the server creates a Gully Analytics login for this
   wallet and shows its password once), add websites, copy the install snippet (with data-web3), watch
   this month's events against the plan, and buy or extend a plan with Gully Pay. Every plan figure comes
   from the server (GET /api/developer/analytics, which reads server/plans.mjs); nothing is priced here. */

const n = (v: number) => v.toLocaleString('en-US')

const snippet = (origin: string, id: string) => `<script defer src="${origin}/script.js"\n  data-website-id="${id}"\n  data-web3="true"></script>`

type Secret = { username: string; password: string; first: boolean } | null

function PasswordDialog({ secret, loginUrl, onClose }: { secret: Secret; loginUrl: string; onClose: () => void }) {
  return (
    <Dialog open={!!secret} onClose={onClose} title={secret?.first ? 'Your Gully Analytics login' : 'Your new password'} dismissable={false}>
      {secret ? (
        <div className="flex flex-col gap-4">
          <p className="m-0 flex items-start gap-3 rounded-[10px] border border-gold-line bg-[rgba(232,192,96,.06)] px-4 py-3 text-[14px] leading-[1.55] text-ink-2">
            <AlertTriangle size={18} className="mt-[2px] shrink-0 text-gold" aria-hidden />
            Copy the password now. It is shown this once and we do not keep it. Lost it? Reset it from this tab.
          </p>
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11px] tracking-[1px] text-faint">USERNAME</span>
            <div className="flex items-center gap-2 rounded-[10px] border border-line bg-bg py-1 pr-1 pl-3">
              <code className="min-w-0 flex-1 font-mono text-[13px] break-all text-ink">{secret.username}</code>
              <CopyButton text={secret.username} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11px] tracking-[1px] text-faint">PASSWORD</span>
            <div className="flex items-center gap-2 rounded-[10px] border border-gold-line bg-bg py-1 pr-1 pl-3">
              <code className="min-w-0 flex-1 font-mono text-[13px] break-all text-gold" data-testid="analytics-password">
                {secret.password}
              </code>
              <CopyButton text={secret.password} />
            </div>
          </div>
          <a href={loginUrl} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1 font-mono text-[12px] text-muted hover:text-gold">
            Sign in at {loginUrl.replace(/^https:\/\//, '')} <ArrowUpRight size={12} aria-hidden />
          </a>
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
    <section className={`${panel} relative gap-4 overflow-hidden`} style={rise(0)} aria-labelledby="ga-start">
      <div aria-hidden className="pointer-events-none absolute -top-32 right-[-12%] size-[420px] rounded-full bg-[radial-gradient(circle,rgba(232,192,96,.12),transparent_62%)]" />
      <div className="relative flex flex-col gap-2">
        <span className="font-mono text-[10px] tracking-[1px] text-gold">GULLY ANALYTICS</span>
        <h2 id="ga-start" className="m-0 font-display text-[clamp(28px,3.4cqw,40px)] leading-[.95] font-bold uppercase">
          Analytics that <span className="text-gold">see the wallet</span>
        </h2>
        <p className="m-0 max-w-[640px] text-[14px] leading-[1.6] text-muted">Page views plus wallet connects, chains and transactions for your dapp, on a dashboard of your own. Cookie-free, one script tag with data-web3. Starting creates a Gully Analytics login for this wallet; you add websites here and read them there.</p>
      </div>
      {view.trialAvailable && trial ? (
        <ul className="relative m-0 grid list-none grid-cols-3 gap-px overflow-hidden rounded-[10px] border border-line bg-line p-0 max-[600px]:grid-cols-1">
          {[
            [`${view.offer.analytics.trialDays} days`, 'free, no payment'],
            [`${trial.sites} website${trial.sites === 1 ? '' : 's'}`, 'with Web3 tracking'],
            [`${n(trial.eventsPerMonth)}`, 'events a month'],
          ].map(([v, l]) => (
            <li key={l} className="flex flex-col gap-1 bg-surface-deep px-4 py-3">
              <span className="font-display text-[26px] leading-none font-bold text-ink">{v}</span>
              <span className="font-mono text-[11px] text-faint">{l}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="relative m-0 rounded-[10px] border border-line-strong bg-surface-deep px-4 py-3 text-[14px] text-ink-2">This wallet has had its free trial. You can create a login again and choose a plan to start recording.</p>
      )}
      {!view.configured && (
        <p className="relative m-0 rounded-[10px] border border-line-strong bg-surface-deep px-4 py-3 text-[14px] text-ink-2" role="status">
          Self-serve sign-up is not switched on on this server yet. Write to hello@gullylabs.xyz for early access.
        </p>
      )}
      {err && <ErrorLine>{err}</ErrorLine>}
      <div className="relative flex flex-wrap items-center gap-2">
        <button type="button" onClick={start} disabled={busy || !view.configured} className={`${pillGold} px-6`}>
          {busy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <ChartNoAxesCombined size={17} aria-hidden />}
          {busy ? 'Creating your login…' : view.trialAvailable ? 'Start free trial' : 'Create my login'}
        </button>
        <a href={`${DOCS_URL}/analytics`} className={pillLine}>
          How it works <ArrowUpRight size={15} aria-hidden />
        </a>
      </div>
    </section>
  )
}

function SiteRow({ site, origin, usage, share, onDelete }: { site: AnalyticsSite; origin: string; usage: SiteUsage; share: number; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-3">
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
          <a href={site.dashboardUrl} target="_blank" rel="noopener" className={pillSm}>
            Open <ArrowUpRight size={13} aria-hidden />
          </a>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={pillSm}>
            <Code2 size={14} aria-hidden /> {open ? 'Hide snippet' : 'Install'}
          </button>
          <button type="button" onClick={onDelete} aria-label={`Remove ${site.name}`} className="inline-flex size-11 items-center justify-center rounded-full border border-line-strong text-muted transition-colors hover:border-error hover:text-error">
            <Trash2 size={15} aria-hidden />
          </button>
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
  const usageOf = (id: string): SiteUsage => (usage === 'loading' ? 'loading' : 'error' in usage ? ({ id, ok: false, error: usage.error } as const) : usage.sites.find((s) => s.id === id))

  return (
    <section className={panel} style={rise(1)} aria-labelledby="ga-sites">
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
        <Empty icon={<Globe size={26} className="text-gold" aria-hidden />} title="No websites yet">
          Add your dapp’s domain to get its website id and the one-line install snippet.
        </Empty>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {account.sites.map((s) => (
            <SiteRow key={s.id} site={s} origin={origin} usage={usageOf(s.id)} share={totalEvents ? s.eventsThisMonth / totalEvents : 0} onDelete={() => setRemoving(s)} />
          ))}
        </ul>
      )}
      {canAdd ? (
        <form onSubmit={add} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] items-end gap-3 border-t border-line pt-3 max-[760px]:grid-cols-1">
          <label className="flex flex-col gap-2 text-[13px] text-ink-2">
            Name
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required placeholder="My dapp" />
          </label>
          <label className="flex flex-col gap-2 text-[13px] text-ink-2">
            Domain
            <input className={input} value={domain} onChange={(e) => setDomain(e.target.value)} maxLength={253} required placeholder="app.example.com" inputMode="url" autoCapitalize="off" spellCheck={false} />
          </label>
          <button type="submit" disabled={busy || !name.trim() || !domain.trim()} className={pillGold}>
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Plus size={16} aria-hidden />} Add website
          </button>
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
    <section className={panel} style={rise(2)} aria-labelledby="ga-plans">
      <div className="flex flex-col gap-[2px]">
        <h2 id="ga-plans" className={panelTitle}>
          Analytics plans
        </h2>
        <span className={mono}>
          Priced in USD · paid on {offer.chains.map((c) => c.name).join(', ')} · {offer.analytics.periodDays} days per payment · nothing renews by itself · separate from the API plans
        </span>
      </div>
      {!offer.checkout.enabled && (
        <p className="m-0 rounded-[10px] border border-line-strong bg-surface-deep px-4 py-3 text-[14px] text-ink-2" role="status">
          {offer.checkout.reason} The limits below are what each plan will include.
        </p>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3">
        {paid.map((p) => {
          const isCur = account.state === 'active' && account.plan?.id === p.id
          return (
            <div key={p.id} className={`flex flex-col gap-3 rounded-[12px] border bg-surface-deep p-4 ${isCur ? 'border-gold-line' : 'border-line'}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-2 text-[15px] font-semibold">
                  {p.name}
                  {isCur && <span className="rounded-full border border-gold-line px-2 font-mono text-[10px] text-gold">CURRENT</span>}
                </span>
                <span className="font-display text-[30px] leading-none font-bold">
                  {p.priceUsdc} <span className="font-mono text-[11px] font-normal text-faint">USD / {offer.analytics.periodDays} days</span>
                </span>
              </div>
              <span className="font-mono text-[12px] text-muted">
                {p.sites} websites · {n(p.eventsPerMonth)} events a month · Web3 tracking
              </span>
              <button type="button" disabled={!offer.checkout.enabled} onClick={() => onBuy(p)} className={isCur ? pillLine : pillGold}>
                {!offer.checkout.enabled ? 'Not on sale yet' : isCur ? `Extend ${p.name} by ${offer.analytics.periodDays} days` : `Choose ${p.name}`}
              </button>
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
              <a href={done.txUrl} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1 font-mono text-[12px] text-ink-2 hover:text-gold">
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
      {switching && account.plan && <p className="m-0 rounded-[10px] border border-gold-line bg-[rgba(232,192,96,.06)] px-4 py-3 text-[14px] text-ink-2">You are on {account.plan.name} until {fmtDate(account.expiresAt)}. A different plan starts today; the days left on {account.plan.name} are not carried over.</p>}
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

function StatusCard({ account, onReset }: { account: AnalyticsAccount; onReset: () => void }) {
  const lapsed = account.state === 'lapsed'
  const left = daysLeft(account.expiresAt)
  return (
    <section className={panel} style={rise(0)} aria-labelledby="ga-status">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="flex max-w-[560px] min-w-0 flex-col gap-2">
          <span className="flex items-center gap-2 text-[12px] text-dim">
            <span className="size-2 rounded-full" style={{ background: lapsed ? '#ff8a7a' : account.state === 'active' ? '#e8c060' : '#6aa6ff' }} aria-hidden /> Gully Analytics plan
          </span>
          <h2 id="ga-status" className="m-0 font-display text-[40px] leading-none font-bold uppercase">
            <span className={lapsed ? 'text-error' : account.state === 'active' ? 'text-gold' : 'text-ink'}>{lapsed ? 'Ended' : account.plan?.name}</span>
            {!lapsed && left !== null && <span className="ml-3 font-mono text-[13px] font-normal text-muted normal-case">{left === 0 ? 'ends today' : `${left} day${left === 1 ? '' : 's'} left`}</span>}
          </h2>
          <span className="text-[14px] leading-[1.55] text-muted">
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
        <div className="flex min-w-[240px] flex-[1_1_320px] flex-col gap-2">
          <EventsMeter account={account} />
          <span className="text-[12px] leading-[1.5] text-faint">Every tracker call counts: page views, custom events and Web3 events. At the limit the server stops recording until the month turns or you upgrade.</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-muted">
          <KeyRound size={15} className="text-gold" aria-hidden /> Login <code className="font-mono text-[13px] text-ink">{account.username}</code>
          <CopyButton text={account.username} label="Copy" className="!min-h-9 border-none !px-2 text-[11px]" />
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onReset} className={pillSm}>
            Reset password
          </button>
          <a href={account.loginUrl} target="_blank" rel="noopener" className={pillGold}>
            Open Gully Analytics <ArrowUpRight size={14} aria-hidden />
          </a>
        </span>
      </div>
    </section>
  )
}

function Payments({ payments }: { payments: Payment[] }) {
  return (
    <section className={panel} style={rise(3)} aria-labelledby="ga-payments">
      <div className="flex flex-col gap-[2px]">
        <h2 id="ga-payments" className={panelTitle}>
          Analytics payments
        </h2>
        <span className={mono}>Every payment this wallet has made for Gully Analytics</span>
      </div>
      {!payments.length ? (
        <Empty icon={<Receipt size={26} className="text-gold" aria-hidden />} title="No payments yet">
          Payments for a Gully Analytics plan appear here with their transaction on the chain’s explorer.
        </Empty>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0 font-mono text-[13px]">
          {payments.map((p) => (
            <li key={`${p.chainId}:${p.txHash}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-[10px] border border-line px-3 py-2">
              <span className="text-muted">{fmtDate(p.at)}</span>
              <span className="text-ink uppercase">{p.plan}</span>
              <span className="text-ink-2">
                {p.amount} {p.symbol} · {p.chain}
              </span>
              <span className="text-muted">
                {fmtDate(p.periodStart)} – {fmtDate(p.expiresAt)}
              </span>
              {p.txUrl ? (
                <a href={p.txUrl} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1 text-ink-2 hover:text-gold">
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
    <div className="flex flex-col gap-[14px]">
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
