import { Activity, ArrowLeftRight, Check, CreditCard, Droplets, ImagePlus, Layers, Loader2, Network, ReceiptText, Search, Server, Shield, UserCheck, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { toastError, toastSuccess } from '../../components/ui/toast'
import { api } from '../developers/api'
import { ExtLink } from '../developers/ExtLink'
import { GullyIdButton, gullyIdAccessToken, gullyIdRedirectToken, isGullyIdReturn } from '../developers/gullyId'
import { chip, input, pillGold, pillLine } from '../developers/styles'
import { checkChainId, getOffer, getQuote, gullyExchange, hasGullySession, startCheckout, TALK_TO_US, type Offer, type Order, type Quote, type Tier } from './chainApi'
import { ChainShell, PriceSummary } from './parts'

/* Create a chain (app.gullylabs.xyz/create-chain): five steps ending in Gully Pay's hosted checkout, or in a recorded order
   when nothing is due. The server prices everything (GET /api/chain-orders/quote); this page only shows it. Our own code,
   written clean: nothing here comes from the Orbit deployment UI fork, which has no upstream licence. People provision
   each chain by hand for now. */

const STEPS: { label: string; icon: LucideIcon }[] = [
  { label: 'Chain', icon: Network },
  { label: 'Plan', icon: Layers },
  { label: 'Price', icon: ReceiptText },
  { label: 'Sign in', icon: UserCheck },
  { label: 'Pay', icon: CreditCard },
]
const ICONS: Record<string, LucideIcon> = { search: Search, bridge: ArrowLeftRight, droplets: Droplets, server: Server, activity: Activity, layers: Layers, shield: Shield }
const DRAFT = 'gl-chain-draft'
const MAX_LOGO = 96 * 1024

interface Draft {
  name: string
  chainId: string
  gasToken: string
  gasSymbol: string
  logo: string | null
  tier: Tier
  addons: string[]
  parent: number | null
  email: string
  step: number
}
const EMPTY: Draft = { name: '', chainId: '', gasToken: 'eth', gasSymbol: '', logo: null, tier: 'testnet', addons: [], parent: null, email: '', step: 0 }

function readDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT)
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Draft) } : null
  } catch {
    return null
  }
}
function writeDraft(d: Draft | null) {
  try {
    if (d) sessionStorage.setItem(DRAFT, JSON.stringify(d))
    else sessionStorage.removeItem(DRAFT)
  } catch {
    /* the page works without it */
  }
}

const parentOf = (offer: Offer, d: Draft) => offer.parents[d.tier].find((p) => p.id === d.parent) ?? offer.parents[d.tier][0]
const field = 'flex min-w-0 flex-col gap-1 text-[13px] text-muted'
const panel = 'flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-4'

function Stepper({ step, go, free }: { step: number; go: (n: number) => void; free: boolean }) {
  return (
    <ol className="m-0 grid list-none grid-cols-5 gap-1 p-0" aria-label="Steps">
      {STEPS.map((s, i) => {
        const Icon = i < step ? Check : s.icon
        return (
          <li key={s.label}>
            <button type="button" disabled={i >= step} onClick={() => go(i)} aria-current={i === step ? 'step' : undefined} className={`flex min-h-11 w-full flex-col items-center justify-center gap-1 rounded-input border text-[11px] ${i === step ? 'border-gold text-ink' : i < step ? 'border-line text-ink-2' : 'border-line text-faint'}`}>
              <Icon size={16} aria-hidden />
              {free && s.label === 'Pay' ? 'Confirm' : s.label}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function ChainStep({ offer, d, set, id }: { offer: Offer; d: Draft; set: (p: Partial<Draft>) => void; id: { state: string; reason?: string } }) {
  const file = useRef<HTMLInputElement>(null)
  const pick = (f: File | undefined) => {
    if (!f) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) return toastError('That logo will not work', { detail: 'Use a PNG, JPEG or WebP image.' })
    if (f.size > MAX_LOGO) return toastError('That logo is too big', { detail: 'Keep it under 96 KB.' })
    const r = new FileReader()
    r.onload = () => set({ logo: String(r.result) })
    r.readAsDataURL(f)
  }
  return (
    <section className={panel} aria-labelledby="step-chain">
      <h1 id="step-chain" className="m-0 text-[20px] font-semibold text-ink">
        Name your chain
      </h1>
      <label className={field}>
        Chain name
        <input className={input} value={d.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} placeholder="Acme Chain" data-testid="chain-name" />
      </label>
      <label className={field}>
        Chain id
        <span className="flex gap-2">
          <input className={`${input} font-mono`} inputMode="numeric" value={d.chainId} onChange={(e) => set({ chainId: e.target.value.replace(/[^0-9]/g, '') })} placeholder="7084123" data-testid="chain-id" />
          <button type="button" className={`${pillLine} shrink-0`} onClick={() => set({ chainId: String(1_000_000 + Math.floor(Math.random() * 4_000_000_000)) })}>
            Suggest
          </button>
        </span>
      </label>
      <p className={`m-0 min-h-5 font-mono text-[12px] ${id.state === 'taken' ? 'text-error' : 'text-faint'}`} role="status" data-testid="chain-id-check">
        {id.state === 'checking' ? 'Checking…' : id.state === 'free' ? 'This id is free.' : id.state === 'taken' ? id.reason : ''}
      </p>
      <div className={field}>
        Gas token
        <div className="flex flex-wrap gap-2" role="group" aria-label="Gas token">
          {offer.gasTokens.map((g) => (
            <button key={g.id} type="button" aria-pressed={d.gasToken === g.id} className={`${chip(d.gasToken === g.id)} min-h-11`} onClick={() => set({ gasToken: g.id })}>
              {g.name}
            </button>
          ))}
        </div>
      </div>
      {d.gasToken === 'custom' && (
        <label className={field}>
          Token symbol
          <input className={`${input} font-mono`} value={d.gasSymbol} maxLength={8} onChange={(e) => set({ gasSymbol: e.target.value.toUpperCase() })} placeholder="ACME" data-testid="gas-symbol" />
        </label>
      )}
      <div className={field}>
        Logo (optional)
        <div className="flex items-center gap-3">
          {d.logo && <img src={d.logo} alt="Your chain's logo" width={44} height={44} className="size-11 rounded-md object-cover" />}
          <button type="button" className={pillLine} onClick={() => file.current?.click()}>
            <ImagePlus size={16} aria-hidden />
            {d.logo ? 'Change' : 'Add a logo'}
          </button>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-label="Logo file" data-testid="chain-logo" onChange={(e) => pick(e.target.files?.[0])} />
        </div>
      </div>
    </section>
  )
}

function PlanStep({ offer, d, set }: { offer: Offer; d: Draft; set: (p: Partial<Draft>) => void }) {
  const toggle = (id: string) => set({ addons: d.addons.includes(id) ? d.addons.filter((a) => a !== id) : [...d.addons, id] })
  const addons = offer.addons.filter((a) => d.tier === 'testnet' || !a.testnetOnly)
  return (
    <section className={panel} aria-labelledby="step-plan">
      <h1 id="step-plan" className="m-0 text-[20px] font-semibold text-ink">
        Pick a plan
      </h1>
      <div className="grid grid-cols-2 gap-2 max-[600px]:grid-cols-1">
        <button type="button" aria-pressed={d.tier === 'testnet'} onClick={() => set({ tier: 'testnet', parent: null })} data-testid="tier-testnet" className={`flex min-h-11 flex-col gap-1 rounded-input border p-3 text-left ${d.tier === 'testnet' ? 'border-gold' : 'border-line'}`}>
          <span className="text-[14px] font-semibold text-ink">Testnet</span>
          <span className="text-[13px] text-muted">Free for {offer.freeDays} days. Settles to Arbitrum Sepolia.</span>
        </button>
        {offer.flags.mainnetOrders ? (
          <button type="button" aria-pressed={d.tier === 'mainnet'} onClick={() => set({ tier: 'mainnet', parent: null, addons: d.addons.filter((a) => a !== 'faucet') })} data-testid="tier-mainnet" className={`flex min-h-11 flex-col gap-1 rounded-input border p-3 text-left ${d.tier === 'mainnet' ? 'border-gold' : 'border-line'}`}>
            <span className="text-[14px] font-semibold text-ink">Managed mainnet</span>
            <span className="text-[13px] text-muted">We run it for you. Settles to Arbitrum One or Nova.</span>
          </button>
        ) : (
          <div className="flex flex-col gap-1 rounded-input border border-line p-3" data-testid="tier-mainnet-talk">
            <span className="text-[14px] font-semibold text-ink">Managed mainnet</span>
            <span className="text-[13px] text-muted">We run it for you. Settles to Arbitrum One or Nova.</span>
            <ExtLink href={TALK_TO_US} className="inline-flex min-h-11 items-center gap-1 text-[14px] font-semibold text-gold">
              Talk to us
            </ExtLink>
          </div>
        )}
      </div>
      {offer.parents[d.tier].length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Settles to">
          {offer.parents[d.tier].map((p) => (
            <button key={p.id} type="button" aria-pressed={parentOf(offer, d).id === p.id} className={`${chip(parentOf(offer, d).id === p.id)} min-h-11`} onClick={() => set({ parent: p.id })}>
              {p.name}
            </button>
          ))}
        </div>
      )}
      <p className="m-0 text-[12px] leading-[1.4] text-faint" data-testid="licence-note">
        {offer.licenceNote}
      </p>
      <h2 className="m-0 text-[15px] font-semibold text-ink">Add-ons</h2>
      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 max-[600px]:grid-cols-1">
        {addons.map((a) => {
          const Icon = ICONS[a.icon] ?? Layers
          const on = d.addons.includes(a.id)
          return (
            <li key={a.id}>
              <button type="button" aria-pressed={on} onClick={() => toggle(a.id)} data-testid={`addon-${a.id}`} className={`flex min-h-11 w-full items-start gap-2 rounded-input border p-3 text-left ${on ? 'border-gold' : 'border-line'}`}>
                <Icon size={16} className="mt-0.5 shrink-0 text-gold" aria-hidden />
                <span className="flex min-w-0 flex-col">
                  <span className="text-[14px] text-ink">{a.name}</span>
                  <span className="text-[12px] text-muted">{a.fee ? `${a.body} ${a.fee}.` : a.body}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function ReviewStep({ offer, d, free }: { offer: Offer; d: Draft; free: boolean }) {
  const rows: [string, string][] = [
    ['Name', d.name],
    ['Chain id', d.chainId],
    ['Gas token', d.gasToken === 'eth' ? 'ETH' : d.gasSymbol],
    ['Plan', d.tier === 'testnet' ? 'Testnet' : 'Managed mainnet'],
    ['Settles to', parentOf(offer, d).name],
  ]
  return (
    <section className={panel} aria-labelledby="step-price">
      <h1 id="step-price" className="m-0 text-[20px] font-semibold text-ink">
        Check your order
      </h1>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="m-0 min-w-0 text-right font-mono text-[13px] break-words text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 text-[13px] leading-[1.4] text-muted">{offer.billing.note} A person at Gully Labs sets up your chain {free ? 'once you place the order' : 'after payment'}.</p>
    </section>
  )
}

export function CreateChainPage() {
  const nav = useNavigate()
  const [offer, setOffer] = useState<Offer | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [d, setD] = useState<Draft>(() => readDraft() ?? EMPTY)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [id, setId] = useState<{ state: string; reason?: string }>({ state: '' })
  const [signedIn, setSignedIn] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = useCallback((p: Partial<Draft>) => setD((x) => ({ ...x, ...p })), [])

  useEffect(() => {
    document.title = 'Create a chain · Gully Labs'
    void getOffer().then((r) => {
      if (!r.ok) return setLoadError(r.error)
      setOffer(r.data)
      setD((x) => (readDraft() || x.addons.length ? x : { ...x, addons: r.data.addons.filter((a) => a.standard).map((a) => a.id) }))
    })
    void hasGullySession().then(setSignedIn)
  }, [])
  // Not before the offer: the first save would hide that the add-on defaults still have to be set.
  useEffect(() => {
    if (offer) writeDraft(d)
  }, [d, offer])

  useEffect(() => {
    let live = true
    void getQuote(d.tier, d.addons).then((r) => live && r.ok && setQuote(r.data.quote))
    return () => {
      live = false
    }
  }, [d.tier, d.addons])

  useEffect(() => {
    if (!d.chainId) return setId({ state: '' })
    setId({ state: 'checking' })
    const t = setTimeout(() => {
      void checkChainId(d.chainId).then((r) => setId(r.ok ? (r.data.free ? { state: 'free' } : { state: 'taken', reason: r.data.reason }) : { state: 'taken', reason: r.error }))
    }, 350)
    return () => clearTimeout(t)
  }, [d.chainId])

  const finishSignIn = useCallback(async (token: string) => {
    const r = await gullyExchange(token)
    if (!r.ok) return toastError('Could not sign in', { detail: r.error })
    setSignedIn(true)
    toastSuccess('Signed in with Gully ID')
  }, [])
  useEffect(() => {
    if (!isGullyIdReturn(window.location.search)) return
    gullyIdRedirectToken()
      .then((t) => (t ? finishSignIn(t) : undefined))
      .catch((e) => toastError('Could not sign in', { detail: e instanceof Error ? e.message : undefined }))
  }, [finishSignIn])
  const signIn = async () => {
    setBusy(true)
    try {
      await finishSignIn(await gullyIdAccessToken())
    } catch (e) {
      toastError('Could not sign in', { detail: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  const canNext = useMemo(() => {
    if (d.step === 0) return d.name.trim().length >= 3 && id.state === 'free' && (d.gasToken === 'eth' || /^[A-Z][A-Z0-9]{1,7}$/.test(d.gasSymbol))
    if (d.step === 2) return !!quote
    if (d.step === 3) return signedIn
    return true
  }, [d, id.state, quote, signedIn])

  const free = quote?.dueCents === 0
  const pay = async () => {
    if (!offer || !quote) return
    setBusy(true)
    const r = await api<{ order: Order; duplicate?: boolean }>('/api/chain-orders', { method: 'POST', body: { tier: d.tier, name: d.name.trim(), chainId: Number(d.chainId), gasToken: d.gasToken, gasSymbol: d.gasSymbol, parentChainId: parentOf(offer, d).id, addons: d.addons, logo: d.logo, email: d.email.trim(), expect: { dueCents: quote.dueCents } } })
    if (!r.ok) {
      setBusy(false)
      if (r.code === 'price-changed') void getQuote(d.tier, d.addons).then((q) => q.ok && setQuote(q.data.quote))
      if (r.status === 401) setSignedIn(false)
      return toastError('Could not place the order', { detail: r.error })
    }
    const order = r.data.order
    writeDraft(null)
    if (r.data.duplicate) toastSuccess('You already have this order', { detail: 'Opening it.' })
    if (order.status !== 'awaiting_payment') return nav(`/create-chain/orders/${order.id}`)
    const c = await startCheckout(order.id)
    if (c.ok) return window.location.assign(c.data.payUrl)
    setBusy(false)
    toastError('Could not open checkout', { detail: c.error })
    nav(`/create-chain/orders/${order.id}`)
  }

  if (loadError) {
    return (
      <ChainShell>
        <p className="m-0 font-mono text-[12px] text-error">{loadError}</p>
      </ChainShell>
    )
  }
  if (!offer) {
    return (
      <ChainShell>
        <p className="m-0 font-mono text-[12px] text-faint">Loading…</p>
      </ChainShell>
    )
  }

  return (
    <ChainShell>
      <Stepper step={d.step} go={(step) => set({ step })} free={free} />
      <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-4 max-[860px]:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-4">
          {d.step === 0 && <ChainStep offer={offer} d={d} set={set} id={id} />}
          {d.step === 1 && <PlanStep offer={offer} d={d} set={set} />}
          {d.step === 2 && <ReviewStep offer={offer} d={d} free={free} />}
          {d.step === 3 && (
            <section className={panel} aria-labelledby="step-signin">
              <h1 id="step-signin" className="m-0 text-[20px] font-semibold text-ink">
                Sign in with Gully ID
              </h1>
              <p className="m-0 text-[14px] text-muted">Your order and its status stay with your Gully ID.</p>
              {signedIn ? (
                <p className="m-0 flex items-center gap-2 text-[14px] text-ink" data-testid="signed-in">
                  <Check size={16} className="text-gold" aria-hidden />
                  Signed in
                </p>
              ) : (
                <GullyIdButton onClick={() => void signIn()} busy={busy} />
              )}
              <label className={field}>
                Email for status updates (optional)
                <input className={input} type="email" autoComplete="email" value={d.email} onChange={(e) => set({ email: e.target.value })} placeholder="you@example.com" data-testid="chain-email" />
              </label>
            </section>
          )}
          {d.step === 4 && (
            <section className={panel} aria-labelledby="step-pay">
              <h1 id="step-pay" className="m-0 text-[20px] font-semibold text-ink">
                {free ? 'Place your order' : 'Pay with Gully Pay'}
              </h1>
              {free ? (
                <p className="m-0 text-[14px] text-muted" data-testid="nothing-due">
                  Nothing to pay today. We record your order and a person at Gully Labs sets up your chain.
                </p>
              ) : offer.checkout.enabled ? (
                <p className="m-0 text-[14px] text-muted">You pay on Gully Pay's secure checkout, then come back here to follow your order.</p>
              ) : (
                <p className="m-0 text-[14px] text-muted" data-testid="checkout-off">
                  Payments are not connected yet.{' '}
                  <ExtLink href={TALK_TO_US} className="inline-flex items-center gap-1 text-gold">
                    Talk to us
                  </ExtLink>
                </p>
              )}
              <button type="button" className={pillGold} disabled={busy || !quote || (!free && !offer.checkout.enabled)} onClick={() => void pay()} data-testid="pay">
                {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : free ? <Check size={18} aria-hidden /> : <CreditCard size={18} aria-hidden />}
                {free ? (busy ? 'Placing your order…' : 'Place order') : busy ? 'Opening checkout…' : 'Go to checkout'}
              </button>
            </section>
          )}
          <div className="flex justify-between gap-2">
            <button type="button" className={pillLine} disabled={d.step === 0} onClick={() => set({ step: d.step - 1 })}>
              Back
            </button>
            {d.step < 4 && (
              <button type="button" className={pillGold} disabled={!canNext} onClick={() => set({ step: d.step + 1 })} data-testid="next">
                Next
              </button>
            )}
          </div>
        </div>
        <PriceSummary quote={quote} />
      </div>
    </ChainShell>
  )
}
