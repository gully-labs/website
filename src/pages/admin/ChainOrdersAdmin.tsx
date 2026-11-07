import { useCallback, useEffect, useMemo, useState } from 'react'
import { C } from '../../components/charts/chartPresets'
import { toastError, toastSuccess } from '../../components/ui/toast'
import { dateTimePT, dayPT, lastDaysPT } from '../../lib/time'
import { LiveDayBars } from './DailyChart'
import { adminCall } from './payAdmin'

/* Admin: Create a chain orders (server/chain-orders.mjs). People provision each chain by hand, then move the order on
   here: Paid, Setting up, Live. Paid itself is never a button: only a verified Gully Pay webhook sets it. A held payment
   (a real payment on a test order, a wrong amount, a second payment) shows its reason. Polled every 30 s. */

interface Row {
  id: string
  status: string
  statusLabel: string
  tier: string
  name: string
  chainId: number
  email: string | null
  address: string
  createdAt: string
  next: string[]
  review: { at: string; code: string; detail: string; resolved: boolean }[]
}
interface Data {
  orders: Row[]
  flags: { mainnetOrders: boolean }
  checkout: { enabled: boolean; mode: string }
}

const card = 'flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-6 max-[600px]:p-4'
const btn = 'inline-flex min-h-11 items-center rounded-full border border-line-strong px-3 text-[13px] text-ink-2 hover:border-gold hover:text-ink disabled:opacity-50'
const LABEL: Record<string, string> = { setting_up: 'Start setup', live: 'Mark live', cancelled: 'Cancel' }

export function ChainOrdersAdmin({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const load = useCallback(() => {
    adminCall<Data>(token, '/api/admin/chain-orders').then((r) => (r.ok ? (setData(r.data), setErr(null)) : setErr(r.error)))
  }, [token])
  useEffect(() => {
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load])
  const days = useMemo(() => {
    const rows = lastDaysPT(30).map((d) => ({ day: d.key, orders: 0 }))
    for (const o of data?.orders ?? []) {
      const d = rows.find((x) => x.day === dayPT(o.createdAt))
      if (d) d.orders++
    }
    return rows
  }, [data])
  const move = async (o: Row, status: string) => {
    setBusy(o.id)
    const r = await adminCall(token, `/api/admin/chain-orders/${o.id}/status`, { status })
    setBusy('')
    if (r.ok) toastSuccess(`${o.name}: ${status === 'setting_up' ? 'setting up' : status}`)
    else toastError('Could not move the order', { detail: r.error })
    load()
  }
  const resolve = async (o: Row) => {
    setBusy(o.id)
    const r = await adminCall(token, `/api/admin/chain-orders/${o.id}/resolve`, {})
    setBusy('')
    if (!r.ok) toastError('Could not clear the hold', { detail: r.error })
    load()
  }
  return (
    <section className={card} aria-labelledby="admin-chain-orders" data-testid="admin-chain-orders">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="admin-chain-orders" className="m-0 font-display text-[22px] font-bold uppercase">
          Chain orders
        </h2>
        {data && (
          <span className="font-mono text-[12px] text-faint">
            {data.orders.length} orders · checkout {data.checkout.enabled ? data.checkout.mode : 'off'} · mainnet {data.flags.mainnetOrders ? 'on' : 'off'}
          </span>
        )}
      </div>
      {err && <p className="m-0 font-mono text-[12px] text-error">{err}</p>}
      {!data && !err && <span className="font-mono text-[12px] text-faint">Loading…</span>}
      {data && <LiveDayBars days={days} series={[{ key: 'orders', label: 'Orders', color: C.gold }]} height={120} unit="orders" empty="Orders will draw here." />}
      {data && !!data.orders.length && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {data.orders.slice(0, 100).map((o) => (
            <li key={o.id} className="flex flex-col gap-2 rounded-input border border-line px-3 py-2" data-testid={`admin-order-${o.chainId}`}>
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <b className="text-[14px] font-medium break-words text-ink">{o.name}</b>
                <span className="font-mono text-[12px] text-ink-2">{o.statusLabel}</span>
              </span>
              <span className="font-mono text-[12px] break-all text-faint">
                {o.chainId} · {o.tier} · {dateTimePT(o.createdAt)} · {o.email ?? 'no email'} · {o.address}
              </span>
              {o.review
                .filter((r) => !r.resolved)
                .map((r) => (
                  <span key={r.at + r.code} className="font-mono text-[12px] text-error">
                    {r.code}: {r.detail}
                  </span>
                ))}
              <span className="flex flex-wrap gap-2">
                {o.next.map((s) => (
                  <button key={s} type="button" className={btn} disabled={busy === o.id} onClick={() => void move(o, s)}>
                    {LABEL[s] ?? s}
                  </button>
                ))}
                {o.review.some((r) => !r.resolved) && (
                  <button type="button" className={btn} disabled={busy === o.id} onClick={() => void resolve(o)}>
                    Clear hold
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
