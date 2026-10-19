import { ArrowRight, Loader2 } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AssetPicker } from '../../components/pay/AssetPicker'
import { Seo } from '../../components/Seo'
import { payApi, type PayAsset, type PayLink } from './api'
import { accentOf, GULLY_BRAND, linkItems, pills, type Brand, type Viewer } from './brand'
import { CheckoutFrame, MobilePayBar, PayPanel } from './CheckoutFrame'
import { OrderSummary } from './OrderSummary'
import { LinkClosed, LoadFailed, Missing, Reading, Unavailable } from './PayStates'

/* /pay/l/<linkId>: a reusable Gully Pay link. The payer sees what it is for and the amount (or types
   one between the link's bounds), picks an asset, and gets an invoice of their own; the checkout
   (/pay/<invoice>) takes it from there. The server checks the amount, the asset and the link's state.
   The form (LinkForm) is shared with merchant links (src/pages/merchant-pay). */

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

const SEO = <Seo title="Pay Gully Labs" bare noindex description="Pay with crypto in ETH, BNB, USDC or USDT, wallet to wallet, through Gully Pay." />

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
      {SEO}
      {state.k === 'loading' && <Reading what="payment link" />}
      {state.k === 'missing' && <Missing what="payment link" text="This address does not match a payment link. Check that it was copied whole, or ask whoever sent it for a new one." />}
      {state.k === 'error' && <LoadFailed what="payment link" message={state.message} retry={load} />}
      {state.k === 'ok' && <LinkView link={state.link} />}
    </>
  )
}

/**
 * The link's payer form: the amount (when open), the asset, and Continue; posts to `api` and goes to the invoice.
 * `showFee` (merchant stores): the picker says per chain whether the store's fee rides inside the payment or is invoiced.
 */
export function LinkForm({ link, api, brand, showFee = false, children }: { link: Pick<PayLink, 'id' | 'amount' | 'assets'>; api: string; brand: Brand; showFee?: boolean; children?: ReactNode }) {
  const navigate = useNavigate()
  const [asset, setAsset] = useState<string | null>(link.assets.length === 1 ? link.assets[0].id : null)
  const [usd, setUsd] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const open = link.amount.type === 'open' ? link.amount : null
  const accent = accentOf(brand)

  let amountErr: string | null = null
  if (open && usd.trim()) {
    const v = usd.trim()
    if (!AMOUNT_RE.test(v)) amountErr = 'Dollars, with at most two decimals.'
    else if (toCents(v) < BigInt(open.minCents) || toCents(v) > BigInt(open.maxCents)) amountErr = `From ${open.min} to ${open.max} USD.`
  }
  const ready = !!asset && (!open || (!!usd.trim() && !amountErr))

  const go = async () => {
    if (!ready || busy) return
    setBusy(true)
    setErr(null)
    const r = await payApi<{ path: string }>(api, { method: 'POST', body: { asset, ...(open ? { usd: usd.trim() } : {}) } })
    setBusy(false)
    if (r.ok) navigate(r.data.path)
    else setErr(r.error)
  }
  const total = link.amount.type === 'fixed' ? `${link.amount.usd} USD` : usd.trim() && !amountErr ? `${usd.trim()} USD` : `${open!.min} to ${open!.max} USD`
  const btn = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-btn px-5 text-[15px] font-semibold transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <form
      id="link-form"
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        go()
      }}
    >
      {open && (
        <label className="flex flex-col gap-2">
          <span className="text-[14px] font-semibold text-ink">Amount</span>
          <span className="flex items-center gap-2 rounded-input border border-line-strong bg-bg pr-3 focus-within:border-gold">
            <input className="h-12 min-w-0 flex-1 bg-transparent px-3 text-[22px] font-semibold text-ink outline-none" value={usd} onChange={(e) => setUsd(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" autoComplete="off" placeholder={open.min} aria-invalid={!!amountErr} aria-describedby="amount-hint" data-testid="link-amount" />
            <span className="font-mono text-[13px] text-faint">USD</span>
          </span>
          <span id="amount-hint" className={`font-mono text-[12px] ${amountErr ? 'text-error' : 'text-faint'}`}>
            {amountErr ?? `From ${open.min} to ${open.max} USD.`}
          </span>
        </label>
      )}
      <div className="flex flex-col gap-3">
        <span className="text-[14px] font-semibold text-ink">Network and token</span>
        <AssetPicker assets={link.assets} value={asset} onChange={setAsset} disabled={busy} showFee={showFee} />
      </div>
      {err && (
        <p className="m-0 text-[14px] text-error" role="alert">
          {err}
        </p>
      )}
      <button type="submit" disabled={!ready || busy} className={btn} style={{ background: accent.fill, color: accent.onFill }} data-testid="link-continue">
        {busy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : null}
        Continue to payment <ArrowRight size={17} aria-hidden />
      </button>
      <span className="text-[12px] leading-[1.5] text-faint">You get your own invoice with the exact amount to send, valid for an hour. The quote in your chosen asset holds for 20 minutes.</span>
      {children}
      <MobilePayBar total={total}>
        <button type="submit" form="link-form" disabled={!ready || busy} className={`${btn} shrink-0`} style={{ background: accent.fill, color: accent.onFill }}>
          Continue <ArrowRight size={16} aria-hidden />
        </button>
      </MobilePayBar>
    </form>
  )
}

/** The live charts beside a link: the chosen (or first) native coin's price and each chain's confirmations. */
export function LinkCharts({ assets }: { assets: PayAsset[] }) {
  const priceAsset = assets.find((a) => a.kind === 'native') ?? null
  return (
    <div className="flex flex-col gap-5 rounded-card border border-line bg-surface p-5 max-[600px]:p-4">
      <Suspense fallback={<span className="block h-[150px] animate-pulse rounded-input bg-surface-deep" />}>
        {priceAsset && <PriceChart asset={priceAsset} />}
        <ChainConfirmations assets={assets} />
      </Suspense>
    </div>
  )
}

function LinkView({ link, viewer = null }: { link: PayLink; viewer?: Viewer | null }) {
  const live = link.state === 'active' && link.checkout.enabled
  const pill = link.state !== 'active' ? pills.closed : !link.checkout.enabled ? pills.closed : pills.link
  return (
    <CheckoutFrame
      brand={GULLY_BRAND}
      bar={live}
      summary={
        <OrderSummary brand={GULLY_BRAND} eyebrow="Gully Pay" title={link.title} items={linkItems(link)} total={link.amount.type === 'fixed' ? link.amount.usd : null} description={link.description}>
          <LinkCharts assets={link.assets} />
        </OrderSummary>
      }
    >
      <PayPanel title="Pay Gully Labs" copyLink={`${window.location.host}/pay/l/${link.id}`} pill={pill} label="Start a payment">
        {link.state !== 'active' && <LinkClosed state={link.state} text={link.stateText} brand={GULLY_BRAND} viewer={viewer} />}
        {link.state === 'active' && !link.checkout.enabled && <Unavailable brand={GULLY_BRAND} reason={link.checkout.reason} viewer={viewer} />}
        {live && <LinkForm link={link} api={`/api/pay/l/${link.id}/invoice`} brand={GULLY_BRAND} />}
      </PayPanel>
    </CheckoutFrame>
  )
}
