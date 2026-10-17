import { ArrowUpRight, CheckCircle2, CreditCard, Loader2, Receipt, ShieldCheck } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { btnGold, btnOutline } from '../../components/ui'
import { isLocalHost, SITE_URL } from '../../site-host'
import { api, fmtDate, shortAddress, type Account, type BillingView, type Intent, type Payment, type Plan } from './api'
import { CopyButton } from './Dialog'
import { Empty, ErrorLine, Skeleton } from './parts'
import { card, cardTitle, input, rise, sub } from './styles'

/* Plan & billing: the plan in force, the plans on offer (from the server; no price is typed here),
   checkout in USDC on Base straight to the treasury wallet, and the wallet's payment history. */

const PayUsdc = lazy(() => import('./PayUsdc'))
const PRICING_URL = isLocalHost() ? '/pricing' : `${SITE_URL}/pricing`
const basescanTx = (h: string) => `https://basescan.org/tx/${h}`
const basescanAddr = (a: string) => `https://basescan.org/address/${a}`

type Check = { state: 'idle' } | { state: 'checking'; hash: string } | { state: 'pending'; hash: string; message: string; tries: number } | { state: 'done'; payment: Payment } | { state: 'error'; message: string }

function Limits({ p }: { p: Plan }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px] text-muted">
      <li>
        <b className="font-medium text-ink">{p.perMin.toLocaleString('en-US')}</b> requests a minute per key
      </li>
      <li>
        <b className="font-medium text-ink">{p.alerts}</b> gap alert{p.alerts === 1 ? '' : 's'}
      </li>
      <li>
        <b className="font-medium text-ink">{p.historyDays}</b> days of gap history
      </li>
      <li>Up to {p.maxKeys} keys</li>
    </ul>
  )
}

function Field({ label, value, mono = true, copy }: { label: string; value: string; mono?: boolean; copy?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10.5px] tracking-[1px] text-faint">{label}</span>
      <div className="flex items-center gap-2 rounded-input border border-line bg-bg py-1 pr-1 pl-3">
        <span className={`min-w-0 flex-1 break-all ${mono ? 'font-mono text-[13px]' : 'text-[14px]'} text-ink`}>{value}</span>
        {copy !== undefined && <CopyButton text={copy} />}
      </div>
    </div>
  )
}

function Checkout({ intent, current, onPaid, onCancel }: { intent: Intent; current: BillingView['plan']; onPaid: () => void; onCancel: () => void }) {
  const [hash, setHash] = useState('')
  const [walletErr, setWalletErr] = useState('')
  const [check, setCheck] = useState<Check>({ state: 'idle' })
  const [showWallet, setShowWallet] = useState(false)
  // Bumped on unmount and on every new check, so a check that is waiting stops when it is superseded.
  const run = useRef(0)
  useEffect(() => {
    const r = run
    return () => void r.current++
  }, [])

  // Checks the hash; while Base answers "not confirmed yet" (202) it asks again every six seconds, for up to six minutes.
  const verify = async (txHash: string) => {
    const me = ++run.current
    setCheck({ state: 'checking', hash: txHash })
    for (let tries = 0; ; tries++) {
      const r = await api<{ payment: Payment }>('/api/developer/checkout/verify', { method: 'POST', body: { plan: intent.plan, txHash } })
      if (me !== run.current) return
      if (r.ok) {
        setCheck({ state: 'done', payment: r.data.payment })
        onPaid()
        return
      }
      if (r.status !== 202 || tries >= 60) {
        setCheck({ state: 'error', message: r.status === 202 ? `${r.error} Still not confirmed after six minutes: check again later with the same hash.` : r.error })
        return
      }
      setCheck({ state: 'pending', hash: txHash, message: r.error, tries: tries + 1 })
      await new Promise((ok) => setTimeout(ok, 6_000))
      if (me !== run.current) return
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (/^0x[0-9a-fA-F]{64}$/.test(hash.trim())) verify(hash.trim())
    else setCheck({ state: 'error', message: 'A transaction hash is 0x followed by 64 hexadecimal characters.' })
  }

  const switching = current.expiresAt && current.id !== intent.plan
  const busy = check.state === 'checking' || check.state === 'pending'

  if (check.state === 'done')
    return (
      <section className={`${card} border-success-line`} style={rise(0)}>
        <div className="flex items-start gap-3">
          <CheckCircle2 size={22} className="mt-[2px] shrink-0 text-green" aria-hidden />
          <div className="flex flex-col gap-1">
            <h2 className={cardTitle}>Payment confirmed</h2>
            <span className="text-[15px] text-muted">
              {check.payment.amount} USDC received. {check.payment.plan === 'pro' ? 'Pro' : 'Business'} runs until {fmtDate(check.payment.expiresAt)}. Your keys have the new limit now.
            </span>
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
          <h2 className={cardTitle}>Pay for {intent.plan === 'pro' ? 'Pro' : 'Business'}</h2>
          <span className={sub}>USDC on Base · {intent.priceUsdc} USDC for 30 days · checkout open until {fmtDate(intent.expiresAt)}</span>
        </div>
        <button type="button" onClick={onCancel} className="font-mono text-[12px] text-muted underline-offset-4 hover:text-ink hover:underline">
          Back to plans
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 max-[760px]:grid-cols-1">
        <Field label="SEND EXACTLY" value={`${intent.amount} USDC`} copy={intent.amount} />
        <Field label="TO THE TREASURY ON BASE" value={intent.treasury} copy={intent.treasury} />
      </div>
      <p className="m-0 text-[13px] leading-[1.6] text-faint">
        The few millionths above the price tag this checkout as yours, so you can pay from any wallet or exchange that sends USDC on Base. From the wallet you signed in with, any amount of at least {intent.priceUsdc} USDC also counts. Token:{' '}
        <a href={basescanAddr(intent.token)} target="_blank" rel="noopener" className="font-mono text-ink-2 underline-offset-4 hover:underline">
          USDC {shortAddress(intent.token)}
        </a>{' '}
        on Base (chain {intent.chainId}). Treasury:{' '}
        <a href={basescanAddr(intent.treasury)} target="_blank" rel="noopener" className="font-mono text-ink-2 underline-offset-4 hover:underline">
          view on Basescan
        </a>
        . We never hold your funds; the transfer goes straight to that wallet.
      </p>
      {switching && <p className="m-0 rounded-input border border-gold-line bg-[rgba(232,192,96,.06)] px-4 py-3 text-[14px] text-ink-2">You are on {current.name} until {fmtDate(current.expiresAt)}. A different plan starts today; the days left on {current.name} are not carried over.</p>}

      <div className="grid grid-cols-2 gap-5 border-t border-line pt-5 max-[760px]:grid-cols-1">
        <div className="flex flex-col gap-3">
          <span className="font-mono text-[11px] tracking-[1px] text-faint">ONE CLICK</span>
          {showWallet ? (
            <Suspense fallback={<Skeleton h={44} />}>
              <PayUsdc
                intent={intent}
                onError={setWalletErr}
                onSent={(h) => {
                  setHash(h)
                  verify(h)
                }}
              />
            </Suspense>
          ) : (
            <button type="button" onClick={() => setShowWallet(true)} className={`${btnGold} inline-flex min-h-11 items-center justify-center gap-2 px-5 text-[15px]`}>
              <CreditCard size={16} aria-hidden /> Pay with a wallet
            </button>
          )}
          {walletErr && <ErrorLine>{walletErr}</ErrorLine>}
        </div>
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <label className="flex flex-col gap-2">
            <span className="font-mono text-[11px] tracking-[1px] text-faint">OR PASTE THE TRANSACTION HASH</span>
            <input className={`${input} font-mono text-[13px]`} value={hash} onChange={(e) => setHash(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" />
          </label>
          <button type="submit" disabled={busy || !hash.trim()} className={`${btnOutline} inline-flex min-h-11 items-center justify-center gap-2 px-5 text-[15px] disabled:opacity-50`}>
            {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
            Check payment
          </button>
        </form>
      </div>

      {check.state === 'checking' && (
        <p className="m-0 inline-flex items-center gap-2 font-mono text-[12px] text-muted" role="status">
          <Loader2 size={14} className="animate-spin" aria-hidden /> Reading the transaction on Base…
        </p>
      )}
      {check.state === 'pending' && (
        <p className="m-0 inline-flex flex-wrap items-center gap-2 font-mono text-[12px] text-muted" role="status">
          <Loader2 size={14} className="animate-spin" aria-hidden /> {check.message} Checking every few seconds.{' '}
          <a href={basescanTx(check.hash)} target="_blank" rel="noopener" className="text-ink-2 underline-offset-4 hover:underline">
            Basescan
          </a>
        </p>
      )}
      {check.state === 'error' && <ErrorLine>{check.message}</ErrorLine>}
    </section>
  )
}

export function Billing({ account, reload }: { account: Account; reload: () => Promise<void> }) {
  const [view, setView] = useState<BillingView | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [intent, setIntent] = useState<Intent | null>(null)
  const [startErr, setStartErr] = useState<string | null>(null)
  const [starting, setStarting] = useState<string | null>(null)

  const load = useCallback(
    () =>
      api<BillingView>('/api/developer/billing').then((r) => {
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

  const start = async (plan: string) => {
    setStarting(plan)
    setStartErr(null)
    const r = await api<{ intent: Intent }>('/api/developer/checkout', { method: 'POST', body: { plan } })
    setStarting(null)
    if (!r.ok) return setStartErr(r.error)
    setIntent(r.data.intent)
  }

  const onPaid = useCallback(() => {
    load()
    reload()
  }, [load, reload])

  if (err) return <ErrorLine onRetry={load}>Billing could not be read: {err}</ErrorLine>
  if (!view)
    return (
      <div className="flex flex-col gap-3">
        <Skeleton h={140} />
        <Skeleton h={220} />
      </div>
    )

  const cur = view.plan
  const offer = view.offer
  const paid = offer.plans.filter((p) => p.priceUsdc > 0)

  return (
    <div className="flex flex-col gap-5">
      <section className={card} style={rise(0)}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-[6px]">
            <span className={sub}>CURRENT PLAN</span>
            <h2 className="m-0 font-display text-[40px] leading-none font-extrabold uppercase">
              <span className={cur.id === 'free' ? 'text-ink' : 'text-gold'}>{cur.name}</span>
            </h2>
            <span className="text-[14px] text-muted">
              {cur.expiresAt ? (
                <>
                  Runs until <b className="font-medium text-ink">{fmtDate(cur.expiresAt)}</b> ({cur.source === 'admin' ? 'granted by Gully Labs' : 'paid'}). It does not renew by itself: pay again to extend it, or let it lapse to return to Free.
                </>
              ) : (
                <>Free for as long as you like. No card, no email.</>
              )}
            </span>
          </div>
          <Limits p={cur} />
        </div>
      </section>

      {intent ? (
        <Checkout
          key={intent.id}
          intent={intent}
          current={cur}
          onPaid={onPaid}
          onCancel={() => {
            setIntent(null)
            load()
          }}
        />
      ) : (
        <section className={card} style={rise(1)}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-[6px]">
              <h2 className={cardTitle}>Plans</h2>
              <span className={sub}>
                Paid in {offer.currency} on {offer.chain.name} · {offer.periodDays} days per payment · no subscription to cancel
              </span>
            </div>
            <a href={PRICING_URL} className="inline-flex items-center gap-1 font-mono text-[12px] text-muted hover:text-gold">
              Pricing page and FAQ <ArrowUpRight size={12} aria-hidden />
            </a>
          </div>
          {!offer.checkout.enabled && (
            <p className="m-0 rounded-input border border-line-strong bg-surface-deep px-4 py-3 text-[14px] text-ink-2" role="status">
              {offer.checkout.reason} The limits below are what each plan will include.
            </p>
          )}
          <div className="grid grid-cols-2 gap-4 max-[760px]:grid-cols-1">
            {paid.map((p) => {
              const isCur = cur.id === p.id
              return (
                <div key={p.id} className={`flex flex-col gap-4 rounded-card border bg-surface-deep p-5 ${isCur ? 'border-gold-line' : 'border-line'}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-display text-[26px] leading-none font-bold uppercase">{p.name}</span>
                    <span className="font-display text-[30px] leading-none font-extrabold text-gold">
                      {p.priceUsdc} <span className="font-mono text-[12px] font-normal text-faint">USDC / {offer.periodDays} days</span>
                    </span>
                  </div>
                  <Limits p={p} />
                  <button
                    type="button"
                    disabled={!offer.checkout.enabled || !!starting}
                    onClick={() => start(p.id)}
                    className={`${isCur ? btnOutline : btnGold} inline-flex min-h-11 items-center justify-center gap-2 px-5 text-[15px] disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {starting === p.id && <Loader2 size={15} className="animate-spin" aria-hidden />}
                    {!offer.checkout.enabled ? 'Not on sale yet' : isCur ? `Extend ${p.name} by ${offer.periodDays} days` : `Choose ${p.name}`}
                  </button>
                </div>
              )
            })}
          </div>
          {startErr && <ErrorLine>{startErr}</ErrorLine>}
          <p className="m-0 flex items-start gap-2 border-t border-line pt-4 text-[13px] leading-[1.6] text-faint">
            <ShieldCheck size={15} className="mt-[2px] shrink-0 text-gold" aria-hidden />
            You send USDC straight to the Gully Labs treasury wallet; we never hold your funds or a card. The server checks the transfer on Base before the plan starts, and each transaction counts once.
          </p>
        </section>
      )}

      <section className={card} style={rise(2)}>
        <div className="flex flex-col gap-[6px]">
          <h2 className={cardTitle}>Payments</h2>
          <span className={sub}>Every payment this wallet has made for a plan</span>
        </div>
        {!view.payments.length ? (
          <Empty icon={<Receipt size={26} className="text-gold" aria-hidden />} title="No payments yet">
            Payments you make for a plan appear here with their transaction on Basescan.
          </Empty>
        ) : (
          <div className="-mx-2 overflow-x-auto px-2">
            <table className="w-full min-w-[620px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-left font-mono text-[10.5px] tracking-[1px] text-faint">
                  <th className="py-2 pr-3 font-medium">DATE</th>
                  <th className="py-2 pr-3 font-medium">PLAN</th>
                  <th className="py-2 pr-3 font-medium">AMOUNT</th>
                  <th className="py-2 pr-3 font-medium">FROM</th>
                  <th className="py-2 pr-3 font-medium">PERIOD</th>
                  <th className="py-2 text-right font-medium">TRANSACTION</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {view.payments.map((p) => (
                  <tr key={p.txHash} className="border-b border-line last:border-b-0">
                    <td className="py-[10px] pr-3 text-muted">{fmtDate(p.at)}</td>
                    <td className="py-[10px] pr-3 text-ink uppercase">{p.plan}</td>
                    <td className="py-[10px] pr-3 text-ink-2">{p.amount} USDC</td>
                    <td className="py-[10px] pr-3 text-muted">{p.from === account.address ? 'this wallet' : shortAddress(p.from)}</td>
                    <td className="py-[10px] pr-3 text-muted">
                      {fmtDate(p.periodStart)} – {fmtDate(p.expiresAt)}
                    </td>
                    <td className="py-[10px] text-right">
                      <a href={basescanTx(p.txHash)} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-ink-2 hover:text-gold">
                        {shortAddress(p.txHash)} <ArrowUpRight size={12} aria-hidden />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
