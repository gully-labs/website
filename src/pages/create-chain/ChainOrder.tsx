import { AlertTriangle, Check, CircleDashed, Clock, CreditCard, ExternalLink, Loader2, Minus, Rocket, Wrench, X, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { toastError, toastInfo, toastSuccess } from '../../components/ui/toast'
import { dateTimePT } from '../../lib/time'
import { GullyIdButton, gullyIdAccessToken } from '../developers/gullyId'
import { pillGold, pillLine } from '../developers/styles'
import { cancelOrder, getOrder, gullyExchange, startCheckout, usd, type EndpointKey, type Order, type OrderStatus, type Provisioning, type StepState } from './chainApi'
import { ChainDiagram, ChainShell, GullyIdChip, PriceSummary, quoteServices } from './parts'

/* One order: Received (or Paid), Setting up, Live. The status moves on a verified Gully Pay webhook, the signed Chain Kit
   pipeline or our team in the admin, never from here; the page polls it and raises a toast the moment it changes. Times are
   Los Angeles time, labelled PT. */

const STAGES: { status: OrderStatus; label: string; icon: LucideIcon }[] = [
  { status: 'paid', label: 'Paid', icon: CreditCard },
  { status: 'setting_up', label: 'Setting up', icon: Wrench },
  { status: 'live', label: 'Live', icon: Rocket },
]
const RANK: Record<OrderStatus, number> = { awaiting_payment: -1, cancelled: -1, paid: 0, setting_up: 1, live: 2 }

/** With nothing to pay, the first stage says Received: this order was never paid. */
const stagesOf = (order: Order) => (order.quote.dueCents === 0 ? STAGES.map((s) => (s.status === 'paid' ? { ...s, label: 'Received' } : s)) : STAGES)

function Progress({ status, stages, history }: { status: OrderStatus; stages: typeof STAGES; history: Order['history'] }) {
  const at = RANK[status]
  const when = (s: OrderStatus) => [...history].reverse().find((h) => h.status === s)?.at
  return (
    <ol className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Order status" data-testid="order-progress">
      <li aria-hidden className="h-1 overflow-hidden rounded-bar bg-line">
        <div className="h-full bg-gold transition-[width] duration-700 ease-out" style={{ width: `${((at + 1) / stages.length) * 100}%` }} />
      </li>
      <li className="grid grid-cols-3 gap-2">
        {stages.map((s, i) => {
          const Icon = i <= at ? Check : s.icon
          const t = i <= at ? when(s.status) : undefined
          return (
            <span key={s.status} aria-current={i === at ? 'step' : undefined} className={`flex flex-col items-center gap-1 text-center text-[13px] ${i <= at ? 'text-ink' : 'text-faint'}`} data-testid={`stage-${s.status}`}>
              <Icon size={18} className={i <= at ? 'text-gold' : ''} aria-hidden />
              {s.label}
              {t && (
                <time dateTime={t} className="text-[11px] text-faint">
                  {dateTimePT(t)}
                </time>
              )}
            </span>
          )
        })}
      </li>
    </ol>
  )
}

/* The Chain Kit pipeline's own log (server/chain-orders.mjs PROVISIONING): every step of the current run as it reports
   it, and the chain's addresses once they exist. Nothing here is made up: no report, no section. */

const STEP: Record<StepState, { label: string; icon: LucideIcon; cls: string; spin?: boolean }> = {
  done: { label: 'Done', icon: Check, cls: 'border-green/40 text-green' },
  running: { label: 'Running', icon: Loader2, cls: 'border-gold-line text-gold', spin: true },
  waiting: { label: 'Waiting', icon: Clock, cls: 'border-line-strong text-ink-2' },
  pending: { label: 'Pending', icon: CircleDashed, cls: 'border-line text-faint' },
  failed: { label: 'Failed', icon: AlertTriangle, cls: 'border-error-line text-error' },
  skipped: { label: 'Skipped', icon: Minus, cls: 'border-line text-faint' },
}
const ENDPOINTS: { key: EndpointKey; label: string }[] = [
  { key: 'rpc', label: 'RPC' },
  { key: 'explorer', label: 'Explorer' },
  { key: 'bridge', label: 'Bridge' },
  { key: 'faucet', label: 'Faucet' },
  { key: 'multisig', label: 'Multisig' },
  { key: 'bundler', label: 'Bundler' },
]
const linkCls = 'inline-flex items-center gap-1 text-[13px] text-gold underline-offset-2 hover:underline'

function ProvisioningLog({ log }: { log: Provisioning }) {
  const done = log.steps.filter((s) => s.state === 'done' || s.state === 'skipped').length
  const total = log.steps.length
  const endpoints = ENDPOINTS.filter((e) => log.endpoints?.[e.key])
  return (
    <>
      {total > 0 && (
        <section className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-4" aria-labelledby="order-setup" data-testid="order-provisioning">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="order-setup" className="m-0 text-[15px] font-semibold text-ink">
              Setup steps
            </h2>
            <span className="text-[13px] text-muted" data-testid="order-provisioning-count">
              {done} of {total} done
            </span>
          </div>
          <div aria-hidden className="h-1 overflow-hidden rounded-bar bg-line">
            <div className="h-full bg-gold transition-[width] duration-700 ease-out" style={{ width: `${(done / total) * 100}%` }} />
          </div>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {log.steps.map((s) => {
              const st = STEP[s.state]
              const Icon = st.icon
              return (
                <li key={s.id} className="flex min-w-0 flex-col gap-1" data-testid={`step-${s.id}`}>
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <span className="min-w-0 text-[14px] break-words text-ink">{s.title}</span>
                    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-medium ${st.cls}`} data-testid={`step-${s.id}-state`}>
                      <Icon size={13} className={st.spin ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden />
                      {st.label}
                    </span>
                  </div>
                  {s.note && <span className="text-[13px] break-words text-muted">{s.note}</span>}
                  {s.links.length > 0 && (
                    <span className="flex flex-wrap gap-x-3 gap-y-1">
                      {s.links.map((l) => (
                        <a key={l.url + l.label} href={l.url} target="_blank" rel="noopener noreferrer" className={linkCls}>
                          {l.label}
                          <ExternalLink size={12} aria-hidden />
                        </a>
                      ))}
                    </span>
                  )}
                  {(s.startedAt || s.endedAt) && (
                    <span className="text-[12px] text-faint">
                      {s.startedAt && (
                        <>
                          Started <time dateTime={s.startedAt}>{dateTimePT(s.startedAt)}</time>
                        </>
                      )}
                      {s.startedAt && s.endedAt && ' · '}
                      {s.endedAt && (
                        <>
                          {s.state === 'failed' ? 'Stopped' : 'Finished'} <time dateTime={s.endedAt}>{dateTimePT(s.endedAt)}</time>
                        </>
                      )}
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
          <p className="m-0 text-[12px] text-faint">
            Updated <time dateTime={log.updatedAt}>{dateTimePT(log.updatedAt)}</time>
          </p>
        </section>
      )}
      {endpoints.length > 0 && (
        <section className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-surface p-4" aria-labelledby="order-endpoints" data-testid="order-endpoints">
          <h2 id="order-endpoints" className="m-0 text-[15px] font-semibold text-ink">
            Your chain's addresses
          </h2>
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
            {endpoints.map((e) => (
              <div key={e.key} className="contents">
                <dt className="text-[13px] text-muted">{e.label}</dt>
                <dd className="m-0 min-w-0">
                  <a href={log.endpoints?.[e.key]} target="_blank" rel="noopener noreferrer" className={`${linkCls} font-mono break-all`} data-testid={`endpoint-${e.key}`}>
                    {log.endpoints?.[e.key]}
                  </a>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </>
  )
}

export function ChainOrderPage() {
  const { id = '' } = useParams()
  const [search, setSearch] = useSearchParams()
  const [order, setOrder] = useState<Order | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'signin' | 'missing' | 'error'>('loading')
  const [busy, setBusy] = useState(false)
  const seen = useRef<{ status: OrderStatus; error: string | null } | null>(null)

  const load = useCallback(async () => {
    const r = await getOrder(id)
    if (!r.ok) {
      if (r.status === 401) setState('signin')
      else if (r.status === 404) setState('missing')
      else setState((s) => (s === 'ready' ? s : 'error'))
      return
    }
    const o = r.data.order
    const was = seen.current
    if (was && was.status !== o.status) {
      if (o.status === 'cancelled') toastInfo('Order cancelled', { id: `order-${o.status}` })
      else toastSuccess(`Your order is ${o.statusLabel.toLowerCase()}`, { id: `order-${o.status}` })
    }
    if (o.payment.lastError && was?.error !== o.payment.lastError) toastError('The payment did not go through', { detail: o.payment.lastError, id: 'order-payment' })
    seen.current = { status: o.status, error: o.payment.lastError }
    setOrder(o)
    setState('ready')
  }, [id])

  useEffect(() => {
    document.title = 'Your chain order · Gully Labs'
    void load()
  }, [load])
  const awaiting = order?.status === 'awaiting_payment'
  useEffect(() => {
    if (state !== 'ready') return
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), awaiting ? 5_000 : 20_000)
    return () => clearInterval(t)
  }, [state, awaiting, load])

  // Back from Gully Pay. The return address proves nothing: only the webhook marks an order paid.
  useEffect(() => {
    const c = search.get('checkout')
    if (!c) return
    if (c === 'cancelled') toastInfo('Checkout closed', { detail: 'Nothing was charged. You can pay when you are ready.', id: 'order-checkout' })
    else toastInfo('Checking your payment', { detail: 'This page updates once Gully Pay confirms it.', id: 'order-checkout' })
    setSearch({}, { replace: true })
  }, [search, setSearch])

  const pay = async () => {
    setBusy(true)
    const r = await startCheckout(id)
    if (r.ok) return window.location.assign(r.data.payUrl)
    setBusy(false)
    toastError('Could not open checkout', { detail: r.error })
    void load()
  }
  const cancel = async () => {
    setBusy(true)
    const r = await cancelOrder(id)
    setBusy(false)
    if (!r.ok) return toastError('Could not cancel', { detail: r.error })
    void load()
  }
  const signIn = async () => {
    try {
      const r = await gullyExchange(await gullyIdAccessToken())
      if (r.ok) void load()
      else toastError('Could not sign in', { detail: r.error })
    } catch (e) {
      toastError('Could not sign in', { detail: e instanceof Error ? e.message : 'Try again.' })
    }
  }

  if (state !== 'ready' || !order) {
    return (
      <ChainShell>
        <GullyIdChip />
        {state === 'loading' && <p className="m-0 text-[13px] text-faint">Loading…</p>}
        {state === 'error' && <p className="m-0 text-[13px] text-error">This order could not be loaded. Try again.</p>}
        {state === 'missing' && <h1 className="m-0 text-[20px] font-semibold text-ink">We could not find that order</h1>}
        {state === 'signin' && (
          <section className="flex max-w-[360px] flex-col gap-3 rounded-card border border-line bg-surface p-4">
            <h1 className="m-0 text-[20px] font-semibold text-ink">Sign in to see your order</h1>
            <GullyIdButton onClick={() => void signIn()} />
          </section>
        )}
      </ChainShell>
    )
  }

  return (
    <ChainShell>
        <GullyIdChip />
      <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-4 max-[860px]:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-4">
          <section className="flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-4">
            <div className="flex items-center gap-3">
              {order.logo && <img src={order.logo} alt="" width={44} height={44} className="size-11 rounded-md object-cover" />}
              <div className="min-w-0">
                <h1 className="m-0 text-[20px] font-semibold break-words text-ink">{order.name}</h1>
                <p className="m-0 text-[13px] text-faint">
                  Chain {order.chainId} · {order.gasSymbol} · {order.parent.name}
                </p>
              </div>
            </div>
            <p className="m-0 text-[14px] font-semibold text-ink" data-testid="order-status">
              {order.statusLabel}
            </p>
            {order.status === 'cancelled' ? (
              <p className="m-0 text-[14px] text-muted">This order is closed and its chain id is free again.</p>
            ) : (
              <Progress status={order.status} stages={stagesOf(order)} history={order.history} />
            )}
            {order.status !== 'cancelled' && (
              <p className="m-0 text-[14px] text-muted" data-testid="order-updates">
                {order.status === 'live' ? 'Your chain is live.' : `Our team sets up your chain within ${order.quote.setupDays ?? 3} business days${order.quote.dueCents === 0 ? ' of your request' : ' of payment'}.`} Updates appear on this page.
              </p>
            )}
            {order.payment.onHold && (
              <p className="m-0 text-[14px] text-muted" data-testid="order-hold">
                Our team is checking this payment. Updates appear on this page.
              </p>
            )}
            {order.payment.lastError && <p className="m-0 text-[13px] text-error" data-testid="order-error">{order.payment.lastError}</p>}
            {((awaiting && !order.payment.onHold) || (order.status === 'paid' && order.quote.dueCents === 0)) && (
              <div className="flex flex-wrap gap-2">
                {awaiting && (
                  <button type="button" className={pillGold} disabled={busy} onClick={() => void pay()} data-testid="order-pay">
                    {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <CreditCard size={18} aria-hidden />}
                    Pay {usd(order.payment.dueCents)}
                  </button>
                )}
                <button type="button" className={pillLine} disabled={busy} onClick={() => void cancel()} data-testid="order-cancel">
                  <X size={16} aria-hidden />
                  Cancel order
                </button>
              </div>
            )}
          </section>
          {(order.status === 'setting_up' || order.status === 'live') && order.provisioning && <ProvisioningLog log={order.provisioning} />}
          <section className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-surface p-4" aria-labelledby="order-history">
            <h2 id="order-history" className="m-0 text-[15px] font-semibold text-ink">
              History
            </h2>
            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {[...order.history].reverse().map((h) => (
                <li key={`${h.at}-${h.status}`} className="flex flex-col">
                  <span className="text-[13px] text-ink-2">{stagesOf(order).find((s) => s.status === h.status)?.label ?? (h.status === 'cancelled' ? 'Cancelled' : 'Order placed')}</span>
                  {h.note && <span className="text-[13px] text-muted">{h.note}</span>}
                  <time dateTime={h.at} className="text-[12px] text-faint">
                    {dateTimePT(h.at)}
                  </time>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <PriceSummary quote={order.quote}>
          <div className="flex flex-col gap-2">
            <h2 className="m-0 text-[13px] font-semibold text-muted">Your chain</h2>
            <ChainDiagram name={order.name} chainId={String(order.chainId)} logo={order.logo} parent={order.parent.name} services={quoteServices(order.quote)} />
          </div>
        </PriceSummary>
      </div>
    </ChainShell>
  )
}
