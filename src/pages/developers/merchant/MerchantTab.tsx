import { ChartColumn, CircleDollarSign, Download, FileText, Link2, PauseCircle, Share2, Store, UserRound, Wallet, Webhook } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { DOCS_URL } from '../../../site-host'
import { usePoll } from '../poll'
import { ErrorLine, Skeleton } from '../parts'
import { pillGold, pillSm } from '../styles'
import { useSubTab } from '../subtab'
import { InfoTip, RefreshChip, Stepper, SubPanel, SubTabs, type Step, type SubTabItem } from '../ui'
import { payOrigin, siteOrigin, usd, type MerchantView } from './api'
import { PaymentsDashboard } from './Charts'
import { FeesSection, WebhooksSection } from './FeesWebhooks'
import { InvoicesSection, LinksSection, NewLink } from './LinksInvoices'
import { NetworkStrip } from './Network'
import { ShareBox } from './parts'
import { ProfileForm, ProfileSection, WalletForm, WalletsSection } from './Setup'
import { ExtLink } from '../ExtLink'
import { ServiceHeader } from '../services/ServiceHeader'

/* The portal's Merchant tab (#merchant): Gully Pay for other businesses. A workspace sets its receiving
   wallets and store profile, makes pay links and invoices, watches its payments, pays its fee statements
   and sets a webhook. Everything is the workspace's (server/merchants.mjs); the role decides who may
   change what (owners, admins and billing run the store; developers make links and webhooks; viewers read).

   Compact by rule (owner, 2026-10-18): a slim header, a 4-step setup stepper (wallet → name → link → get
   paid; only the current step's form, folding into a thin bar once done), then real sub-tabs showing one
   section at a time (#merchant/<tab>, remembered, sticky): Payments, Links, Invoices, Wallets, Profile,
   Fees, Webhooks. The store view is re-read every 30 s; a failed refresh keeps what is shown and says so. */

const TABS = ['payments', 'links', 'invoices', 'wallets', 'profile', 'fees', 'webhooks'] as const
type Sub = (typeof TABS)[number]

export function MerchantTab() {
  const poll = usePoll<MerchantView>('/api/developer/merchant', 30_000)
  // A form's answer (the store as saved) shows at once, until the next read replaces it.
  const [local, setLocal] = useState<{ base: MerchantView | null; view: MerchantView } | null>(null)
  const view = local && local.base === poll.data ? local.view : poll.data
  const setView = useCallback((v: MerchantView) => setLocal({ base: poll.data, view: v }), [poll.data])
  const [tick, setTick] = useState(0)
  const { reload: reread } = poll
  const reload = useCallback(() => {
    void reread()
    setTick((t) => t + 1)
  }, [reread])
  const [sub, setSub] = useSubTab<Sub>('merchant', TABS, 'payments')
  // Gully AI's "Create a pay link for $25" (?paylink= with #merchant) opens the Links tab with the form.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('paylink')) setSub('links')
  }, [setSub])

  if (!view)
    return poll.error || poll.timedOut ? (
      <ErrorLine onRetry={() => void poll.reload()}>The store could not be read: {poll.error ?? 'no answer in time'}</ErrorLine>
    ) : (
      <div className="flex flex-col gap-2" aria-busy>
        <Skeleton h={64} />
        <Skeleton h={120} />
        <Skeleton h={320} />
      </div>
    )

  const f = view.fees
  const overdue = f.statements.find((s) => s.state === 'overdue')
  const liveWallets = view.wallets.filter((w) => w.enabled && w.status === 'ok')
  const firstLink = view.links.find((l) => l.active) ?? view.links[0] ?? null
  const steps: Step[] = [
    { id: 'wallet', label: 'Add a receiving wallet', icon: <Wallet size={14} aria-hidden />, done: liveWallets.length > 0 },
    { id: 'name', label: 'Name your store', icon: <Store size={14} aria-hidden />, done: !!view.profile.name },
    { id: 'link', label: 'Create a pay link', icon: <Link2 size={14} aria-hidden />, done: view.links.length > 0 },
    { id: 'share', label: 'Share it, get paid', icon: <Share2 size={14} aria-hidden />, done: view.payments.length > 0 },
  ]
  const items: SubTabItem<Sub>[] = [
    { id: 'payments', label: 'Payments', icon: <ChartColumn size={15} aria-hidden />, count: view.payments.length },
    { id: 'links', label: 'Links', icon: <Link2 size={15} aria-hidden />, count: view.links.length },
    { id: 'invoices', label: 'Invoices', icon: <FileText size={15} aria-hidden />, count: view.invoices.length },
    { id: 'wallets', label: 'Wallets', icon: <Wallet size={15} aria-hidden />, count: view.wallets.length, dot: view.wallets.some((w) => w.status === 'not-deployed') },
    { id: 'profile', label: 'Profile', icon: <UserRound size={15} aria-hidden />, dot: !view.profile.name },
    { id: 'fees', label: 'Fees', icon: <CircleDollarSign size={15} aria-hidden />, count: f.statements.filter((s) => s.state === 'open' || s.state === 'overdue').length || null, dot: f.paused || f.outstandingUsd > 0 },
    { id: 'webhooks', label: 'Webhooks', icon: <Webhook size={15} aria-hidden />, count: view.deliveries.length || null },
  ]

  return (
    <div className="flex flex-col gap-2" data-testid="merchant-tab">
      <ServiceHeader
        icon={Store}
        logo={view.profile.logoUrl ? <img src={view.profile.logoUrl} alt="" className="size-10 rounded-[10px] object-contain" /> : undefined}
        eyebrow="GULLY PAY FOR MERCHANTS"
        title={view.profile.displayName}
        accent={view.profile.accent}
        status={f.paused ? { tone: 'down', text: 'Checkout paused' } : view.ready ? { tone: 'live', text: 'Checkout live' } : { tone: 'idle', text: 'Not set up yet' }}
        docs={`${DOCS_URL}/gully-pay-merchants`}
        actions={
          <a href="/api/developer/merchant/export/payments.csv" className={pillSm} download>
            <Download size={14} aria-hidden /> CSV
          </a>
        }
      >
        {!view.profile.name && (
          <button type="button" onClick={() => setSub('profile')} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-gold-line px-3 text-[12px] text-gold hover:border-gold" data-testid="finish-profile">
            <Store size={13} aria-hidden /> Store not named yet
          </button>
        )}
        <RefreshChip error={poll.stale ? poll.error : null} onRetry={() => void poll.reload()} />
      </ServiceHeader>
        <InfoTip summary={`Non-custodial · ${f.ratePct}% per payment after your first ${usd(f.freeUsd)}, no monthly fee.`}>
          {view.nonCustodial} Fee: {f.ratePct}% per payment after your first {usd(f.freeUsd)}, no monthly fee.{' '}
          <ExtLink href={`${siteOrigin()}${view.terms.path}`} className="text-gold underline underline-offset-4 hover:text-gold-hover">
            Merchant terms ↗
          </ExtLink>
        </InfoTip>

      {f.paused && (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-error-line bg-[rgba(255,138,122,.06)] px-4 py-3" role="alert">
          <PauseCircle size={20} className="shrink-0 text-error" aria-hidden />
          <span className="min-w-0 flex-[1_1_240px] text-[13px] leading-[1.5] text-ink">
            <b>Your checkout is paused.</b> Fee statement {overdue?.number} (${overdue?.usd}) is more than {f.pauseAfterDays} days unpaid, so no new payment can start. Paying it resumes checkout at once.
          </span>
          {overdue && (
            <ExtLink href={`${payOrigin()}${overdue.payPath}`} className={pillGold}>
              Pay now ↗
            </ExtLink>
          )}
        </div>
      )}
      {!f.paused && f.outstandingUsd > 0 && (
        <button type="button" onClick={() => setSub('fees')} className="m-0 rounded-[12px] border border-gold-line bg-[rgba(0,210,255,.06)] px-4 py-2 text-left text-[13px] text-ink-2" role="status">
          A fee statement of {usd(f.outstandingUsd)} is open. Pay it within {f.pauseAfterDays} days of issue to keep checkout running. <span className="text-gold">Open Fees</span>
        </button>
      )}

      <Stepper startFolded title="Set up your store" steps={steps} testId="merchant-stepper">
        {(id) =>
          id === 'wallet' ? (
            <WalletForm view={view} onChange={setView} />
          ) : id === 'name' ? (
            <ProfileForm view={view} onChange={setView} />
          ) : id === 'link' ? (
            view.can.links ? <NewLink view={view} onDone={reload} bare /> : <p className="m-0 text-[13px] text-faint">Your role ({view.role}) cannot make pay links.</p>
          ) : firstLink ? (
            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-2 text-[13px] text-muted">
                <span aria-hidden className="size-2 animate-[gl-blink_1.6s_ease-in-out_infinite] rounded-full bg-gold" />
                Share <b className="font-semibold text-ink">{firstLink.title}</b>: the first confirmed payment ticks this step.
              </span>
              <ShareBox path={firstLink.path} label={firstLink.title} />
            </div>
          ) : (
            <p className="m-0 text-[13px] text-muted">Make a pay link or an invoice first, then share it.</p>
          )
        }
      </Stepper>

      <SubTabs items={items} value={sub} onChange={setSub} label="Merchant sections" idBase="merchant" />
      <SubPanel idBase="merchant" value={sub}>
        {sub === 'payments' && (
          <>
            <PaymentsDashboard refreshKey={tick} />
            <NetworkStrip view={view} />
          </>
        )}
        {sub === 'links' && <LinksSection view={view} reload={reload} />}
        {sub === 'invoices' && <InvoicesSection view={view} reload={reload} />}
        {sub === 'wallets' && <WalletsSection view={view} onChange={setView} />}
        {sub === 'profile' && <ProfileSection view={view} onChange={setView} />}
        {sub === 'fees' && <FeesSection view={view} />}
        {sub === 'webhooks' && <WebhooksSection view={view} reload={reload} />}
      </SubPanel>
    </div>
  )
}
