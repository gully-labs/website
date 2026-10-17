import { ArrowRight, Ban, Clock, Loader2, ShieldCheck } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AssetPicker } from '../../components/pay/AssetPicker'
import { Seo } from '../../components/Seo'
import { btnOutline, eyebrow } from '../../components/ui'
import { payApi, type PayLink } from './api'
import { Missing, Notice, Shell } from './PayPage'

/* /pay/l/<linkId>: a reusable Gully Pay link. The payer sees what it is for and the amount (or types
   one between the link's bounds), picks an asset, and gets an invoice of their own; the checkout
   (/pay/<invoice>) takes it from there. The server checks the amount, the asset and the link's state. */

// Live charts (ECharts loads with them, on demand): the chosen coin's Chainlink price, and the
// confirmations each accepted chain needs.
const PriceChart = lazy(() => import('./PayCharts').then((m) => ({ default: m.PriceChart })))
const ChainConfirmations = lazy(() => import('./PayCharts').then((m) => ({ default: m.ChainConfirmations })))

type State = { k: 'loading' } | { k: 'missing' } | { k: 'error'; message: string } | { k: 'ok'; link: PayLink }

const AMOUNT_RE = /^\d{1,9}(\.\d{1,2})?$/
const toCents = (s: string) => {
  const [a, b = ''] = s.split('.')
  return BigInt(a) * 100n + BigInt((b + '00').slice(0, 2))
}

const CLOSED_TITLE: Record<string, string> = { inactive: 'Link switched off', expired: 'Link expired', 'used-up': 'Link used up' }

export function LinkPage() {
  const { id } = useParams()
  const [state, setState] = useState<State>({ k: 'loading' })
  const load = useCallback(() => {
    const read: Promise<State> = !id ? Promise.resolve({ k: 'missing' }) : payApi<{ link: PayLink }>(`/api/pay/l/${encodeURIComponent(id)}`).then((r): State => (r.ok ? { k: 'ok', link: r.data.link } : r.status === 404 ? { k: 'missing' } : { k: 'error', message: r.error }))
    read.then(setState)
  }, [id])
  useEffect(() => {
    load()
  }, [load])

  return (
    <>
      <Seo title={state.k === 'ok' ? state.link.title : 'Pay'} description="Pay with crypto in ETH, BNB, USDC or USDT, wallet to wallet, through Gully Pay." />
      <Shell>
        {state.k === 'loading' && (
          <p className="m-0 inline-flex items-center gap-3 font-mono text-[13px] text-faint">
            <Loader2 size={16} className="animate-spin" aria-hidden /> Reading the payment link…
          </p>
        )}
        {state.k === 'missing' && <Missing what="payment link" text="This address does not match a payment link. Check that it was copied whole, or ask whoever sent it for a new one." />}
        {state.k === 'error' && (
          <div className="flex flex-wrap items-center gap-4 rounded-card border border-[#5a2a24] bg-[rgba(255,138,122,.06)] px-6 py-5 text-[15px] text-error" role="alert">
            The payment link could not be read: {state.message}
            <button type="button" onClick={load} className={`${btnOutline} min-h-11 px-5 text-[14px]`}>
              Try again
            </button>
          </div>
        )}
        {state.k === 'ok' && <LinkView link={state.link} />}
      </Shell>
    </>
  )
}

function LinkView({ link }: { link: PayLink }) {
  const navigate = useNavigate()
  const [asset, setAsset] = useState<string | null>(link.assets.length === 1 ? link.assets[0].id : null)
  const [usd, setUsd] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const open = link.amount.type === 'open' ? link.amount : null
  const live = link.state === 'active' && link.checkout.enabled

  let amountErr: string | null = null
  if (open && usd.trim()) {
    const v = usd.trim()
    if (!AMOUNT_RE.test(v)) amountErr = 'Dollars, with at most two decimals.'
    else if (toCents(v) < BigInt(open.minCents) || toCents(v) > BigInt(open.maxCents)) amountErr = `From ${open.min} to ${open.max} USD.`
  }
  const ready = !!asset && (!open || (!!usd.trim() && !amountErr))
  // The coin whose live price is charted: the chosen one when it is a native coin, else the first accepted.
  const chosen = link.assets.find((a) => a.id === asset)
  const priceAsset = chosen?.kind === 'native' ? chosen : (link.assets.find((a) => a.kind === 'native') ?? null)

  const go = async () => {
    if (!ready || busy) return
    setBusy(true)
    setErr(null)
    const r = await payApi<{ path: string }>(`/api/pay/l/${link.id}/invoice`, { method: 'POST', body: { asset, ...(open ? { usd: usd.trim() } : {}) } })
    setBusy(false)
    if (r.ok) navigate(r.data.path)
    else setErr(r.error)
  }

  const pill = link.state !== 'active' ? { text: CLOSED_TITLE[link.state], cls: 'bg-grid text-muted border-line-strong' } : !link.checkout.enabled ? { text: 'Checkout closed', cls: 'bg-grid text-muted border-line-strong' } : { text: 'Pay link', cls: 'bg-[rgba(232,192,96,.15)] text-gold border-gold-line' }

  return (
    <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,600px)]">
      <div className="flex min-w-0 flex-col gap-4" style={{ animation: 'gl-rise .5s ease both' }}>
        <span className={eyebrow}>GULLY PAY</span>
        <h1 className="m-0 font-display text-[clamp(36px,8vw,64px)] leading-[.92] font-extrabold break-words uppercase">{link.title}</h1>
        {link.amount.type === 'fixed' ? (
          <span className="font-display text-[clamp(40px,9vw,60px)] leading-none font-extrabold text-gold">
            {link.amount.usd} <span className="font-mono text-[14px] font-normal text-faint">USD</span>
          </span>
        ) : (
          <span className="font-mono text-[14px] text-ink-2">
            You choose the amount: {link.amount.min} to {link.amount.max} USD
          </span>
        )}
        {link.description && <p className="m-0 max-w-[620px] text-[16px] leading-[1.6] whitespace-pre-line text-muted">{link.description}</p>}
        <p className="m-0 flex max-w-[620px] items-start gap-2 text-[13px] leading-[1.6] text-faint">
          <ShieldCheck size={15} className="mt-[2px] shrink-0 text-gold" aria-hidden />
          Paid wallet to wallet: your transfer goes straight to the Gully Labs treasury, checked on chain. No account, no card.
        </p>
        <div className="flex max-w-[620px] flex-col gap-5 rounded-card border border-line bg-surface p-5 max-[600px]:p-4">
          <Suspense fallback={<span className="block h-[150px] animate-pulse rounded-input bg-surface-deep" />}>
            {priceAsset && <PriceChart asset={priceAsset} />}
            <ChainConfirmations assets={link.assets} />
          </Suspense>
        </div>
      </div>

      <section className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface" style={{ animation: 'gl-rise .5s .07s ease both' }} aria-label="Start a payment">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 max-[600px]:px-4">
          <span className="flex min-w-0 flex-col leading-[1.25]">
            <b className="truncate text-[15px] font-semibold">{link.title}</b>
            <span className="truncate font-mono text-[11px] text-faint">
              {window.location.host}/pay/l/{link.id}
            </span>
          </span>
          <span className={`shrink-0 rounded-full border px-3 py-[3px] text-[12px] font-semibold ${pill.cls}`}>{pill.text}</span>
        </header>
        <div className="flex flex-col gap-5 p-5 max-[600px]:p-4">
          {link.state !== 'active' && (
            <Notice icon={link.state === 'expired' ? <Clock size={18} className="mt-[3px] shrink-0 text-faint" aria-hidden /> : <Ban size={18} className="mt-[3px] shrink-0 text-faint" aria-hidden />}>
              {link.stateText} Nothing can be paid here. Ask whoever sent you this link for a new one.
            </Notice>
          )}
          {link.state === 'active' && !link.checkout.enabled && <Notice icon={<Ban size={18} className="mt-[3px] shrink-0 text-faint" aria-hidden />}>{link.checkout.reason} Nothing can be sent for it here.</Notice>}
          {live && (
            <form
              className="flex flex-col gap-5"
              onSubmit={(e) => {
                e.preventDefault()
                go()
              }}
            >
              {open && (
                <label className="flex flex-col gap-2">
                  <span className="font-mono text-[11px] tracking-[1px] text-faint">AMOUNT (USD)</span>
                  <span className="flex items-center gap-2 rounded-input border border-line-strong bg-bg pr-3 focus-within:border-gold">
                    <input
                      className="h-12 min-w-0 flex-1 bg-transparent px-3 font-display text-[26px] font-bold text-ink outline-none"
                      value={usd}
                      onChange={(e) => setUsd(e.target.value.replace(/[^\d.]/g, ''))}
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder={open.min}
                      aria-invalid={!!amountErr}
                      aria-describedby="amount-hint"
                    />
                    <span className="font-mono text-[13px] text-faint">USD</span>
                  </span>
                  <span id="amount-hint" className={`font-mono text-[12px] ${amountErr ? 'text-error' : 'text-faint'}`}>
                    {amountErr ?? `From ${open.min} to ${open.max} USD.`}
                  </span>
                </label>
              )}
              <div className="flex flex-col gap-3">
                <span className="font-mono text-[11px] tracking-[1px] text-faint">PAY WITH</span>
                <AssetPicker assets={link.assets} value={asset} onChange={setAsset} disabled={busy} />
              </div>
              {err && (
                <p className="m-0 text-[14px] text-error" role="alert">
                  {err}
                </p>
              )}
              <button type="submit" disabled={!ready || busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-btn bg-gold px-5 text-[16px] font-semibold text-bg transition-colors hover:bg-gold-hover disabled:cursor-not-allowed disabled:opacity-50">
                {busy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : null}
                Continue to checkout <ArrowRight size={17} aria-hidden />
              </button>
              <span className="text-[12px] leading-[1.5] text-faint">You get your own invoice with the exact amount to send, valid for an hour. The quote in your chosen asset holds for 20 minutes.</span>
            </form>
          )}
        </div>
      </section>
    </div>
  )
}
