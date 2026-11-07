import { Check, CreditCard, Loader2, Rocket, Wrench, X, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { toastError, toastInfo, toastSuccess } from '../../components/ui/toast'
import { dateTimePT } from '../../lib/time'
import { GullyIdButton, gullyIdAccessToken } from '../developers/gullyId'
import { pillGold, pillLine } from '../developers/styles'
import { cancelOrder, getOrder, gullyExchange, startCheckout, usd, type Order, type OrderStatus } from './chainApi'
import { ChainShell, PriceSummary } from './parts'

/* One order: Paid, Setting up, Live. The status moves on a verified Gully Pay webhook or a Gully admin, never from here;
   the page polls it and raises a toast the moment it changes. Times are Los Angeles time, labelled PT. */

const STAGES: { status: OrderStatus; label: string; icon: LucideIcon }[] = [
  { status: 'paid', label: 'Paid', icon: CreditCard },
  { status: 'setting_up', label: 'Setting up', icon: Wrench },
  { status: 'live', label: 'Live', icon: Rocket },
]
const RANK: Record<OrderStatus, number> = { awaiting_payment: -1, cancelled: -1, paid: 0, setting_up: 1, live: 2 }

/** With nothing to pay, the first stage says Received: this order was never paid. */
const stagesOf = (order: Order) => (order.quote.dueCents === 0 ? STAGES.map((s) => (s.status === 'paid' ? { ...s, label: 'Received' } : s)) : STAGES)

function Progress({ status, stages }: { status: OrderStatus; stages: typeof STAGES }) {
  const at = RANK[status]
  return (
    <ol className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Order status" data-testid="order-progress">
      <li aria-hidden className="h-1 overflow-hidden rounded-bar bg-line">
        <div className="h-full bg-gold transition-[width] duration-700 ease-out" style={{ width: `${((at + 1) / stages.length) * 100}%` }} />
      </li>
      <li className="grid grid-cols-3 gap-2">
        {stages.map((s, i) => {
          const Icon = i <= at ? Check : s.icon
          return (
            <span key={s.status} aria-current={i === at ? 'step' : undefined} className={`flex flex-col items-center gap-1 text-[13px] ${i <= at ? 'text-ink' : 'text-faint'}`}>
              <Icon size={18} className={i <= at ? 'text-gold' : ''} aria-hidden />
              {s.label}
            </span>
          )
        })}
      </li>
    </ol>
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
        {state === 'loading' && <p className="m-0 font-mono text-[12px] text-faint">Loading…</p>}
        {state === 'error' && <p className="m-0 font-mono text-[12px] text-error">This order could not be loaded. Try again.</p>}
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
      <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-4 max-[860px]:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-4">
          <section className="flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-4">
            <div className="flex items-center gap-3">
              {order.logo && <img src={order.logo} alt="" width={44} height={44} className="size-11 rounded-md object-cover" />}
              <div className="min-w-0">
                <h1 className="m-0 text-[20px] font-semibold break-words text-ink">{order.name}</h1>
                <p className="m-0 font-mono text-[12px] text-faint">
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
              <Progress status={order.status} stages={stagesOf(order)} />
            )}
            {order.payment.onHold && (
              <p className="m-0 text-[14px] text-muted" data-testid="order-hold">
                A person is checking this payment. We will write to you.
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
          <section className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-surface p-4" aria-labelledby="order-history">
            <h2 id="order-history" className="m-0 text-[15px] font-semibold text-ink">
              History
            </h2>
            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {[...order.history].reverse().map((h) => (
                <li key={`${h.at}-${h.status}`} className="flex flex-col">
                  <span className="text-[13px] text-ink-2">{stagesOf(order).find((s) => s.status === h.status)?.label ?? (h.status === 'cancelled' ? 'Cancelled' : 'Order placed')}</span>
                  {h.note && <span className="text-[13px] text-muted">{h.note}</span>}
                  <time dateTime={h.at} className="font-mono text-[11px] text-faint">
                    {dateTimePT(h.at)}
                  </time>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <PriceSummary quote={order.quote} />
      </div>
    </ChainShell>
  )
}
