import { ArrowUpRight, Download, PauseCircle, ShieldCheck, Store } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { DOCS_URL } from '../../../site-host'
import { api } from '../api'
import { ErrorLine, Skeleton } from '../parts'
import { pillGold, pillLine } from '../styles'
import { payOrigin, usd, type MerchantView } from './api'
import { PaymentsDashboard } from './Charts'
import { FeesSection, WebhooksSection } from './FeesWebhooks'
import { InvoicesSection, LinksSection } from './LinksInvoices'
import { ProfileSection, WalletsSection } from './Setup'

/* The portal's Merchant tab (#merchant): Gully Pay for other businesses. A workspace sets its receiving
   wallets and store profile, makes pay links and invoices, watches its payments, pays its fee statements
   and sets a webhook. Everything is the workspace's (server/merchants.mjs); the role decides who may
   change what (owners, admins and billing run the store; developers make links and webhooks; viewers read). */

const NAV = [
  ['m-dashboard', 'Payments'],
  ['m-links', 'Links'],
  ['m-invoices', 'Invoices'],
  ['m-wallets', 'Wallets'],
  ['m-profile', 'Profile'],
  ['m-fees', 'Fees'],
  ['m-webhooks', 'Webhooks'],
] as const

export function MerchantTab() {
  const [view, setView] = useState<MerchantView | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const load = useCallback(() => {
    api<MerchantView>('/api/developer/merchant').then((r) => (r.ok ? (setView(r.data), setErr(null)) : setErr(r.error)))
  }, [])
  useEffect(() => {
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load])
  const reload = useCallback(() => {
    load()
    setTick((t) => t + 1)
  }, [load])

  if (!view)
    return err ? (
      <ErrorLine onRetry={load}>The store could not be read: {err}</ErrorLine>
    ) : (
      <div className="flex flex-col gap-3" aria-busy>
        <Skeleton h={120} />
        <Skeleton h={320} />
      </div>
    )

  const f = view.fees
  const overdue = f.statements.find((s) => s.state === 'overdue')
  const state = f.paused ? { text: 'Checkout paused', cls: 'border-[#5a2a24] text-error' } : view.ready ? { text: 'Checkout live', cls: 'border-success-line text-green' } : { text: 'Not set up yet', cls: 'border-line-strong text-faint' }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-4 rounded-[14px] border border-line bg-surface p-5 max-[600px]:p-4" style={view.profile.accent ? { borderTop: `3px solid ${view.profile.accent}` } : undefined}>
        <div className="flex flex-wrap items-center gap-3">
          {view.profile.logoUrl ? <img src={view.profile.logoUrl} alt="" className="size-11 rounded-[10px] object-contain" /> : <Store size={28} className="text-gold" aria-hidden />}
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="font-mono text-[11px] tracking-[1px] text-faint">GULLY PAY FOR MERCHANTS</span>
            <h1 className="m-0 truncate text-[22px] font-semibold text-ink">{view.profile.displayName}</h1>
          </div>
          <span className={`inline-flex min-h-[30px] items-center gap-2 rounded-full border px-3 text-[13px] ${state.cls}`}>
            <span aria-hidden className={`size-2 rounded-full ${f.paused ? 'bg-error' : view.ready ? 'animate-[gl-live-pulse_2.4s_ease-out_infinite] bg-green' : 'bg-faint'}`} />
            {state.text}
          </span>
          <a href={`/api/developer/merchant/export/payments.csv`} className={pillLine} download>
            <Download size={15} aria-hidden /> CSV
          </a>
          <a href={`${DOCS_URL}/gully-pay-merchants`} target="_blank" rel="noopener" className={pillLine}>
            Docs <ArrowUpRight size={14} aria-hidden />
          </a>
        </div>
        <p className="m-0 flex items-start gap-2 text-[14px] leading-[1.55] text-ink-2">
          <ShieldCheck size={16} className="mt-[3px] shrink-0 text-gold" aria-hidden />
          <span>
            {view.nonCustodial} Fee: {f.ratePct}% per payment after your first {usd(f.freeUsd)}, no monthly fee.
          </span>
        </p>
        <nav aria-label="Merchant sections" className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]">
          {NAV.map(([id, text]) => (
            <a key={id} href={`#${id}`} onClick={(e) => (e.preventDefault(), document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))} className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-[13px] text-dim hover:bg-surface-hover hover:text-ink">
              {text}
            </a>
          ))}
        </nav>
      </header>

      {f.paused && (
        <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-[#5a2a24] bg-[rgba(255,138,122,.06)] px-5 py-4" role="alert">
          <PauseCircle size={22} className="shrink-0 text-error" aria-hidden />
          <span className="min-w-0 flex-1 text-[14px] leading-[1.55] text-ink">
            <b>Your checkout is paused.</b> Fee statement {overdue?.number} (${overdue?.usd}) is more than {f.pauseAfterDays} days unpaid, so payers see “This store's checkout is paused” and no new payment can start. Paying it resumes checkout at once.
          </span>
          {overdue && (
            <a href={`${payOrigin()}${overdue.payPath}`} target="_blank" rel="noopener" className={pillGold}>
              Pay now <ArrowUpRight size={14} aria-hidden />
            </a>
          )}
        </div>
      )}
      {!f.paused && f.outstandingUsd > 0 && (
        <p className="m-0 rounded-[14px] border border-gold-line bg-[rgba(232,192,96,.06)] px-5 py-3 text-[14px] text-ink-2" role="status">
          A fee statement of {usd(f.outstandingUsd)} is open. Pay it within {f.pauseAfterDays} days of issue to keep checkout running (see Fees below).
        </p>
      )}
      {!view.ready && (
        <p className="m-0 rounded-[14px] border border-dashed border-line-strong px-5 py-3 text-[14px] text-muted">
          Start here: add a receiving wallet and name your store. Links and invoices can be made at any time; payers can pay once a wallet is on.
        </p>
      )}

      <PaymentsDashboard refreshKey={tick} />
      <LinksSection view={view} reload={reload} />
      <InvoicesSection view={view} reload={reload} />
      <WalletsSection view={view} onChange={setView} />
      <ProfileSection view={view} onChange={setView} />
      <FeesSection view={view} />
      <WebhooksSection view={view} reload={reload} />
    </div>
  )
}
